import Foundation

public enum MessageKind: String, Equatable, Sendable {
    case user
    case assistant
    case system
    case bot
}

/// One transcript entry. Mirrors what `js/messages/store.js` kept as a plain object plus
/// the `rawContent` / `isComplete` fields `js/messages/stream.js` mutated while streaming.
public struct ChatMessage: Identifiable, Equatable, Sendable {
    public let id: String
    public var kind: MessageKind
    public var content: String
    public var rawContent: String
    public var fromPeer: String?
    public var requestId: String?
    public var timestamp: Date
    public var isComplete: Bool

    public init(
        id: String,
        kind: MessageKind,
        content: String,
        rawContent: String? = nil,
        fromPeer: String? = nil,
        requestId: String? = nil,
        timestamp: Date = Date(),
        isComplete: Bool = true
    ) {
        self.id = id
        self.kind = kind
        self.content = content
        self.rawContent = rawContent ?? content
        self.fromPeer = fromPeer
        self.requestId = requestId
        self.timestamp = timestamp
        self.isComplete = isComplete
    }
}

public struct WirePeer: Identifiable, Equatable, Sendable {
    public let id: String
    public let displayName: String
    public let role: String

    public init(id: String, displayName: String, role: String) {
        self.id = id
        self.displayName = displayName
        self.role = role
    }
}

public struct WireModel: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

/// Everything the UI reacts to. Anything the decoder does not recognise returns `nil`:
/// the client is a viewer, not a validator, and an unknown event must not break the room.
public enum WorkerUpdate: Equatable, Sendable {
    case status(topic: String?, role: String, connected: Bool, peerCount: Int, collaborative: Bool, provider: String?)
    case peers([WirePeer])
    case mode(collaborative: Bool)
    case models(provider: String?, models: [WireModel])
    case message(ChatMessage)
    case response(requestId: String, chunk: String, done: Bool, error: String?)
    case slash(content: String, kind: String)
    case bot(kind: String, text: String, from: String?)
}

public enum WorkerEvent {
    public static func decode(notification: RPCNotification) -> WorkerUpdate? {
        switch notification.name {
        case "chat.event": return decodeChat(notification.data)
        case "harness.event": return decodeHarness(notification.data)
        default: return nil
        }
    }

    private static func decodeChat(_ data: JSONValue) -> WorkerUpdate? {
        switch data["type"]?.string {
        case "status":
            return .status(
                topic: data["topic"]?.string,
                role: data["role"]?.string ?? "none",
                connected: data["connected"]?.bool ?? false,
                peerCount: data["peerCount"]?.int ?? 0,
                collaborative: data["collaborative"]?.bool ?? false,
                provider: data["provider"]?.string
            )

        case "peers":
            let peers = (data["peers"]?.array ?? []).compactMap { entry -> WirePeer? in
                guard let id = entry["id"]?.string else { return nil }
                return WirePeer(
                    id: id,
                    displayName: entry["displayName"]?.string ?? String(id.prefix(6)),
                    role: entry["role"]?.string ?? "peer"
                )
            }
            return .peers(peers)

        case "mode":
            return .mode(collaborative: data["collaborative"]?.bool ?? false)

        case "models":
            let models = (data["models"]?.array ?? []).compactMap { entry -> WireModel? in
                guard let id = entry["id"]?.string else { return nil }
                return WireModel(id: id, name: entry["name"]?.string ?? id)
            }
            return .models(provider: data["provider"]?.string, models: models)

        case "message":
            guard let wire = data["message"], let id = wire["id"]?.string else { return nil }
            let kind = MessageKind(rawValue: wire["type"]?.string ?? "system") ?? .system
            return .message(ChatMessage(
                id: id,
                kind: kind,
                content: wire["content"]?.string ?? "",
                fromPeer: wire["fromPeer"]?.string,
                // The worker emits `Date.now()` milliseconds, not seconds.
                timestamp: Date(timeIntervalSince1970: (wire["timestamp"]?.double ?? 0) / 1000)
            ))

        case "response":
            guard let requestId = data["requestId"]?.string else { return nil }
            return .response(
                requestId: requestId,
                chunk: data["chunk"]?.string ?? "",
                done: data["done"]?.bool ?? false,
                error: data["error"]?.string
            )

        default:
            // `chat_response` belongs to the HTTP bridge and never reaches the UI.
            return nil
        }
    }

    private static func decodeHarness(_ data: JSONValue) -> WorkerUpdate? {
        switch data["type"]?.string {
        case "slash":
            // `content` is the rendered text; `metadata.kind` is the style hint the old UI
            // handed to `js/ui/ephemeral.js` ("slash-help", "slash-error", "slash-placeholder").
            return .slash(
                content: data["content"]?.string ?? "",
                kind: data["metadata"]?["kind"]?.string ?? "slash-help"
            )

        case "bot":
            return .bot(
                kind: data["kind"]?.string ?? "message",
                text: data["text"]?.string ?? "",
                from: data["fromName"]?.string ?? data["from"]?.string
            )

        default:
            return nil
        }
    }
}
