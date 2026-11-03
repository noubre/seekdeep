import Foundation

/// A transient banner shown above the composer. `kind` decides its styling and whether it
/// sticks around — errors outlive the 6-second timer, everything else expires.
public struct Ephemeral: Equatable, Sendable {
    public var content: String
    public var kind: String
    public var createdAt: Date

    public init(content: String, kind: String, createdAt: Date = Date()) {
        self.content = content
        self.kind = kind
        self.createdAt = createdAt
    }
}

/// Why the composer cannot send right now. Derived, never stored: a stored flag would go
/// stale the moment a provider appears or a host disconnects.
public enum EmptyReason: Equatable, Sendable {
    case noProvider
    case noModel
    case noHost
}

/// The renderer's entire view of the room: one value type, mutated only by
/// `ChatReducer`, driven only by worker notifications. No I/O, no timers, no views.
public struct ChatState: Equatable, Sendable {
    public var messages: [ChatMessage] = []
    public var ephemeral: Ephemeral?
    public var topic: String?
    public var role: String = "none"
    public var connected: Bool = false
    public var peerCount: Int = 0
    public var collaborative: Bool = false
    public var provider: String?
    public var peers: [WirePeer] = []
    public var models: [WireModel] = []
    public var selectedModel: String?
    public var thinking: String = ""

    public init() {}

    public var isHost: Bool { role == "host" }

    /// The model the composer should send. Falls back to the first known model so a peer
    /// that never opened the picker can still type and send.
    public var effectiveModel: String? { selectedModel ?? models.first?.id }

    /// `nil` means "ready". Each case mirrors a message the worker itself can produce.
    public var emptyReason: EmptyReason? {
        if provider == nil && models.isEmpty { return .noProvider }
        if effectiveModel == nil { return .noModel }
        // Only a joined peer can be cut off from its host; `role == "none"` is the brief
        // window before `chat.create` returns and must not show an error.
        if role == "peer" && !connected { return .noHost }
        return nil
    }
}
