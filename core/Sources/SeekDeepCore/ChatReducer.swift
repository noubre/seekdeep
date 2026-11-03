import Foundation

public enum ChatReducer {
    /// `js/messages/store.js` keeps at most 100 messages in memory.
    public static let maxHistory = 100

    /// How long a non-error banner stays up (`js/ui/ephemeral.js` behaviour).
    public static let ephemeralLifetime: TimeInterval = 6

    public static func reduce(_ state: ChatState, _ update: WorkerUpdate) -> ChatState {
        var state = state

        switch update {
        case .status(let topic, let role, let connected, let peerCount, let collaborative, let provider):
            state.topic = topic ?? state.topic
            state.role = role
            state.connected = connected
            state.peerCount = peerCount
            state.collaborative = collaborative
            state.provider = provider ?? state.provider

        case .peers(let peers):
            state.peers = peers
            state.peerCount = peers.count

        case .mode(let collaborative):
            state.collaborative = collaborative

        case .models(let provider, let models):
            state.provider = provider ?? state.provider
            state.models = models
            if let selected = state.selectedModel, models.contains(where: { $0.id == selected }) {
                break
            }
            selectedModelForFirstModel(&state)

        case .message(let message):
            append(message, to: &state)

        case .response(let requestId, let chunk, let done, let error):
            if let error, !error.isEmpty {
                append(
                    ChatMessage(
                        id: "err-\(requestId)-\(state.messages.count)",
                        kind: .system,
                        content: "Error: \(error)"
                    ),
                    to: &state
                )
            }
            // The worker sends `done: true` with an empty chunk on success *and* failure,
            // so the terminal frame must be processed even when there was an error.
            guard !chunk.isEmpty || done else { break }
            applyChunk(requestId: requestId, chunk: chunk, done: done, to: &state)

        case .slash(let content, let kind):
            state.ephemeral = Ephemeral(content: content, kind: kind)

        case .bot(let kind, let text, let from):
            let label = kind == "reply" ? "Bot reply" : "Bot \(from ?? "peer")"
            append(
                ChatMessage(
                    id: "bot-\(state.messages.count)-\(abs(text.hashValue))",
                    kind: .bot,
                    content: "\(label): \(text)"
                ),
                to: &state
            )
        }

        return state
    }

    /// True when a banner should be dismissed. Errors never expire on their own.
    public static func shouldExpire(_ banner: Ephemeral?, now: Date = Date()) -> Bool {
        guard let banner, banner.kind != "slash-error" else { return false }
        return now.timeIntervalSince(banner.createdAt) >= ephemeralLifetime
    }

    public static func append(_ message: ChatMessage, to state: inout ChatState) {
        guard !state.messages.contains(where: { $0.id == message.id }) else { return }
        state.messages.append(message)
        if state.messages.count > maxHistory {
            state.messages.removeFirst(state.messages.count - maxHistory)
        }
    }

    // MARK: - internals

    private static func selectedModelForFirstModel(_ state: inout ChatState) {
        state.selectedModel = state.models.first?.id
    }

    /// Appends to the assistant message for `requestId`, creating it on first sight — the
    /// port of `js/messages/stream.js`, including its rule that the *last* matching
    /// assistant message is the streaming target.
    private static func applyChunk(requestId: String, chunk: String, done: Bool, to state: inout ChatState) {
        var message: ChatMessage
        if let index = state.messages.lastIndex(where: { $0.requestId == requestId && $0.kind == .assistant }) {
            message = state.messages[index]
        } else {
            message = ChatMessage(
                id: "asst-\(requestId)",
                kind: .assistant,
                content: "",
                rawContent: "",
                requestId: requestId,
                isComplete: false
            )
            append(message, to: &state)
        }

        guard let index = state.messages.firstIndex(where: { $0.id == message.id }) else { return }
        message.rawContent += chunk
        message.content = message.rawContent
        message.isComplete = message.isComplete || done
        state.messages[index] = message
        state.thinking = Thinking.split(message.rawContent).thinking
    }
}
