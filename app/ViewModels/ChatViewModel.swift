import AppKit
import Foundation
import SeekDeepCore
import SwiftUI

@MainActor
final class ChatViewModel: ObservableObject {
    @Published private(set) var state = ChatState()
    @Published var draft: String = ""
    @Published var joinTopic: String = ""
    @Published private(set) var isBusy = false
    @Published private(set) var slashCommands: [String] = []
    @Published private(set) var isReady = false
    /// OpenAI-compatible endpoint state; `.off` until the worker reports a listener.
    @Published private(set) var api: APIStatus = .off
    /// Newest first, refreshed after every save and delete.
    @Published private(set) var sessions: [SessionStore.Entry] = []
    /// Last prompt the composer accepted, for ⌘R.
    @Published private(set) var lastSentPrompt: String?
    /// Up/↓ prompt history for the composer.
    @Published private(set) var recall = PromptRecall()

    private let transport: any WorkletTransport
    private let client: RPCClient
    private let store: SessionStore
    private var eventTask: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?
    /// Room topic -> when the transcript started, so a reopened session keeps its date.
    private var sessionStart: [String: Date] = [:]

    init(transport: any WorkletTransport, sessionStore: SessionStore) {
        self.transport = transport
        self.client = RPCClient(transport: transport)
        self.store = sessionStore
    }

    deinit {
        saveTask?.cancel()
        eventTask?.cancel()
    }

    func start() async {
        AppLog.note("starting worker")
        do {
            try await client.start()
            AppLog.note("transport started")
            let notifications = client.notifications
            eventTask = Task { [weak self] in
                for await notification in notifications {
                    await self?.handle(notification)
                }
            }
            await bootstrap()
            await loadSlashCommands()
            await reloadSessions()
            isReady = true
            #if DEBUG
            // Smoke hook: `SEEKDEEP_API="server:8080"` (or "bridge:8080") starts the OpenAI
            // surface from the environment so the packed Bare path can be exercised without a
            // human clicking the menu. Debug builds only.
            if let api = ProcessInfo.processInfo.environment["SEEKDEEP_API"], !api.isEmpty {
                let parts = api.split(separator: ":", maxSplits: 1).map(String.init)
                let mode = parts.first ?? "server"
                let port = parts.count > 1 ? (Int(parts[1]) ?? 8080) : 8080
                AppLog.note("smoke: starting API mode=\(mode) port=\(port)")
                await startAPI(mode: mode, port: port)
            }
            // Smoke hook: `SEEKDEEP_AUTOSEND="say hi"` exercises composer -> worker ->
            // reducer without a human at the keyboard.
            if let autoSend = ProcessInfo.processInfo.environment["SEEKDEEP_AUTOSEND"], !autoSend.isEmpty {
                draft = autoSend
                await send()
            }
            #endif
            AppLog.note("worker ready, room=\(state.topic ?? "none")")
        } catch {
            AppLog.fail("worker start: \(error)")
            banner("Could not start the worker: \(error.localizedDescription)", kind: "slash-error")
        }
    }

    func stop() async {
        eventTask?.cancel()
        await client.stop()
    }

    // MARK: - room lifecycle

    /// Mirrors `js/ui/startup.js`: create a room, then reconcile with the authoritative
    /// `chat.status` snapshot. The worker is the source of truth; the view model never
    /// invents room facts.
    private func bootstrap() async {
        do {
            let created = try await client.request("chat.create")
            if let topic = created["topic"]?.string, let role = created["role"]?.string {
                state.topic = topic
                state.role = role
            }
            await refreshStatus()
        } catch {
            state = ChatReducer.reduce(
                state,
                .slash(content: "Could not create a chat room: \(error.localizedDescription)", kind: "slash-error")
            )
        }
        await refreshAPIStatus()
    }

    func refreshStatus() async {
        guard let status = try? await client.request("chat.status") else { return }
        var object = status.object ?? [:]
        object["type"] = .str("status")
        guard let decoded = WorkerEvent.decode(notification: RPCNotification(name: "chat.event", data: .object(object))),
              case .status(let topic, let role, let connected, let peerCount, let collaborative, let provider) = decoded
        else { return }
        state = ChatReducer.reduce(state, .status(
            topic: topic ?? state.topic,
            role: role,
            connected: connected,
            peerCount: peerCount,
            collaborative: collaborative,
            provider: provider
        ))
    }

    // MARK: - OpenAI endpoint

    func refreshAPIStatus() async {
        guard let response = try? await client.request("api.status") else { return }
        api = APIStatus(json: response) ?? .off
    }

    func startAPI(mode: String, port: Int = 8080, apiKey: String = "") async {
        var params: [String: JSONValue] = ["mode": .str(mode), "port": .number(Double(port))]
        let key = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if !key.isEmpty { params["apiKey"] = .str(key) }
        do {
            let response = try await client.request("api.start", params)
            api = APIStatus(json: response) ?? .off
            banner("OpenAI API on \(api.url ?? "?")", kind: "slash-help")
        } catch {
            banner("Could not start the API: \(error.localizedDescription)", kind: "slash-error")
        }
    }

    func stopAPI() async {
        _ = try? await client.request("api.stop")
        await refreshAPIStatus()
    }

    func join() async {
        let topic = joinTopic.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard topic.count == 64, topic.allSatisfy(\.isHexDigit) else {
            banner("Topic key must be 64 hex characters.", kind: "slash-error")
            return
        }
        do {
            let joined = try await client.request("chat.join", ["topic": .str(topic)])
            state.topic = joined["topic"]?.string ?? topic
            state.role = "peer"
            joinTopic = ""
            state = ChatReducer.reduce(state, .message(ChatMessage(
                id: "joined-\(UUID().uuidString)",
                kind: .system,
                content: "Joining \(String(topic.prefix(12)))…"
            )))
            scheduleSave()
        } catch {
            report(error)
        }
    }

    func leave() async {
        _ = try? await client.request("chat.leave")
        state = ChatState()
        state = ChatReducer.reduce(state, .slash(content: "Left the room.", kind: "slash-help"))
    }

    // MARK: - sending

    var isViewingHistory: Bool { state.history != nil }

    var canSend: Bool {
        !isViewingHistory && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isBusy
    }

    /// The bubble still streaming, if any — a send returns long before its answer does.
    var activeRequestId: String? {
        state.messages.last(where: { $0.kind == .assistant && !$0.isComplete })?.requestId
    }

    var canCancel: Bool { activeRequestId != nil }

    func cancel() async {
        guard let id = activeRequestId else { return }
        _ = try? await client.request("chat.cancel", ["requestId": .str(id)])
    }

    func send() async {
        guard !isViewingHistory else {
            banner("History is read-only. Close it to keep chatting.", kind: "slash-help")
            return
        }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isBusy else { return }
        draft = ""
        // Accepted: remember it for ⌘R and the ↑/↓ history.
        recall.record(text)
        lastSentPrompt = text

        ChatReducer.append(
            ChatMessage(
                id: "local-\(UUID().uuidString)",
                kind: .user,
                content: text,
                fromPeer: state.isHost ? "Host" : "You"
            ),
            to: &state
        )

        scheduleSave()

        isBusy = true
        defer { isBusy = false }
        do {
            if text.hasPrefix("/") {
                _ = try await client.request("slash.dispatch", ["text": .str(text)])
            } else {
                guard let model = state.effectiveModel else {
                    throw RPCError(message: "No model available — start Ollama or LM Studio, then refresh.")
                }
                _ = try await client.request("chat.send", ["prompt": .str(text), "model": .str(model)])
            }
        } catch {
            report(error)
        }
    }

    // MARK: - retry and recall

    /// Arrow-key recall is a no-op while a saved transcript is open. While a stream is
    /// running it stays a no-op as long as the draft is untouched, so a running answer
    /// cannot silently replace what the user is typing.
    private var recallAllowed: Bool {
        if isViewingHistory { return false }
        if isBusy && draft.isEmpty { return false }
        return true
    }

    func recallOlder() {
        guard recallAllowed, let text = recall.previous(draft: draft) else { return }
        draft = text
    }

    func recallNewer() {
        guard recallAllowed, let text = recall.next(draft: draft) else { return }
        draft = text
    }

    func canRetry() -> Bool {
        !isViewingHistory && !isBusy && lastSentPrompt != nil
    }

    func retryLastPrompt() async {
        guard !isViewingHistory, !isBusy else {
            banner("Close history or wait for the current answer, then retry.", kind: "slash-help")
            return
        }
        guard let prompt = lastSentPrompt else {
            banner("Nothing to retry yet.", kind: "slash-help")
            return
        }
        draft = prompt
        await send()
    }

    // MARK: - room controls

    func setMode(collaborative: Bool) async {
        do {
            _ = try await client.request("chat.setMode", ["collaborative": .bool(collaborative)])
        } catch {
            report(error)
        }
    }

    func setProvider(_ provider: String) async {
        do {
            _ = try await client.request("chat.setProvider", ["provider": .str(provider)])
            await refreshModels()
        } catch {
            report(error)
        }
    }

    func refreshModels() async {
        do {
            _ = try await client.request("chat.refreshModels")
        } catch {
            report(error)
        }
    }

    func selectModel(_ id: String) {
        state.selectedModel = id
    }

    /// Markdown export of what is on screen, without the reasoning blocks.
    var transcriptMarkdown: String {
        Transcript.markdown(state.messages, topic: state.topic)
    }

    /// Writes the transcript wherever the user points the save panel. Kept on the view
    /// model (not in the view) so the menu command and any future ⌘⇧E handler share it.
    func exportTranscript() {
        guard !state.messages.isEmpty else {
            banner("Nothing to export yet.", kind: "slash-help")
            return
        }
        let panel = NSSavePanel()
        panel.title = "Export transcript"
        panel.nameFieldStringValue = "seekdeep-\(state.topic?.prefix(8) ?? "chat").md"
        panel.allowedContentTypes = [.plainText]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try transcriptMarkdown.write(to: url, atomically: true, encoding: .utf8)
            banner("Exported to \(url.lastPathComponent)", kind: "slash-help")
        } catch {
            report(error)
        }
    }

    func dismissBanner() {
        state.ephemeral = nil
    }

    func expireBannerIfNeeded() {
        if ChatReducer.shouldExpire(state.ephemeral) {
            state.ephemeral = nil
        }
    }

    // MARK: - history

    /// Debounced: a streaming answer arrives as dozens of events, and one file write per
    /// token would be pointless. Cancelling the previous task is what makes it debounce.
    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else { return }
            await self?.persist()
        }
    }

    /// Sessions are keyed by room topic, so a long-running room keeps one transcript that
    /// grows, instead of a new file per launch.
    private func persist() async {
        guard state.history == nil else { return }
        // Boot emits system lines ("joining …"); a launch that never typed anything is not
        // a transcript worth listing, and saving it would add an empty entry every run.
        guard state.messages.contains(where: { $0.kind == .user || $0.kind == .assistant }) else { return }
        let id = state.topic ?? "local"
        if sessionStart[id] == nil { sessionStart[id] = Date() }
        let name = sessionName(for: id)
        do {
            try await store.save(StoredSession(
                id: id,
                name: name,
                createdAt: sessionStart[id] ?? Date(),
                messages: state.messages.map(StoredMessage.init)
            ))
            await reloadSessions()
        } catch {
            AppLog.fail("session save: \(error)")
        }
    }

    private func reloadSessions() async {
        sessions = (try? await store.list()) ?? []
        AppLog.note("history: \(sessions.count) session(s)")
    }

    /// The first prompt names the session. Checked before the stored name so a transcript
    /// that was first saved before any prompt existed upgrades instead of keeping the
    /// topic-prefix placeholder forever.
    private func sessionName(for id: String) -> String {
        if let firstUser = state.messages.first(where: { $0.kind == .user })?.content {
            return String(firstUser.prefix(48))
        }
        if let existing = sessions.first(where: { $0.id == id }), !existing.name.isEmpty {
            return existing.name
        }
        return String(id.prefix(12))
    }

    /// Read-only replay: the room keeps running behind the overlay, which is why nothing
    /// is written back to the session being viewed.
    func openSession(_ entry: SessionStore.Entry) async {
        guard let stored = try? await store.load(id: entry.id) else {
            banner("That session could not be read.", kind: "slash-error")
            return
        }
        state.history = HistoryView(
            id: entry.id,
            name: entry.name,
            messages: stored.messages.map(\.chatMessage)
        )
        banner("Viewing history — read-only.", kind: "slash-help")
    }

    func closeHistory() {
        state.history = nil
        state.historyUnread = 0
    }

    /// Renames a saved session and refreshes the menu. The open overlay follows the new
    /// name so the bar does not keep the old title.
    func renameSession(_ entry: SessionStore.Entry, to name: String) async {
        do {
            guard let updated = try await store.rename(id: entry.id, name: name) else {
                banner("That session could not be renamed.", kind: "slash-error")
                return
            }
            if state.history?.id == updated.id {
                state.history?.name = updated.name
            }
            await reloadSessions()
            banner("Renamed to \(updated.name).", kind: "slash-help")
        } catch {
            report(error)
        }
    }

    func deleteSession(_ entry: SessionStore.Entry) async {
        do {
            try await store.delete(id: entry.id)
            await reloadSessions()
            banner("Deleted \(String(entry.id.prefix(8))).", kind: "slash-help")
        } catch {
            report(error)
        }
    }

    func clearConversation() {
        state.messages = []
        banner("Cleared this conversation.", kind: "slash-help")
    }

    // MARK: - internals

    private func loadSlashCommands() async {
        guard let result = try? await client.request("slash.list"),
              let plugins = result["plugins"]?.array else { return }
        slashCommands = plugins
            .compactMap { $0["commands"]?.array }
            .flatMap { $0 }
            .compactMap(\.string)
            .sorted()
    }

    private func handle(_ notification: RPCNotification) async {
        guard let event = WorkerEvent.decode(notification: notification) else { return }
        state = ChatReducer.reduce(state, event)
        if case .message = event { scheduleSave() }
        if case .response = event { scheduleSave() }
        if case .response(_, let chunk, let done, let error) = event, done {
            let answer = state.messages.last(where: { $0.kind == .assistant })
            AppLog.note("response done: chunk=\(chunk.count) chars, error=\(error ?? "none"), assistant=\(answer?.rawContent.count ?? 0) chars")
        }
        // The worker's status events are the authoritative source for role/peers; the
        // view model only tracks its own transient UI state on top.
    }

    private func banner(_ content: String, kind: String) {
        state = ChatReducer.reduce(state, .slash(content: content, kind: kind))
    }

    private func report(_ error: Error) {
        banner((error as? RPCError)?.message ?? error.localizedDescription, kind: "slash-error")
    }
}
