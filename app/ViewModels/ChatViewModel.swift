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
    /// Newest first, refreshed after every save and delete.
    @Published private(set) var sessions: [SessionStore.Entry] = []

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
