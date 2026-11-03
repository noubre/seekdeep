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

    private let transport: any WorkletTransport
    private let client: RPCClient
    private var eventTask: Task<Void, Never>?

    init(transport: any WorkletTransport) {
        self.transport = transport
        self.client = RPCClient(transport: transport)
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

    var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isBusy
    }

    func send() async {
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
