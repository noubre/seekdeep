import Foundation

public struct StoredSession: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public var name: String
    public var createdAt: Date
    public var messages: [StoredMessage]

    public init(id: String, name: String, createdAt: Date, messages: [StoredMessage]) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
        self.messages = messages
    }
}

/// `ChatMessage` with a `Codable` shape that survives a schema change: `kind` is stored as
/// its raw string and unknown values decode as `.system` rather than throwing.
public struct StoredMessage: Codable, Equatable, Sendable {
    public var id: String
    public var kind: String
    public var content: String
    public var rawContent: String
    public var fromPeer: String?
    public var requestId: String?
    public var timestamp: Date
    public var isComplete: Bool

    public init(_ message: ChatMessage) {
        id = message.id
        kind = message.kind.rawValue
        content = message.content
        rawContent = message.rawContent
        fromPeer = message.fromPeer
        requestId = message.requestId
        timestamp = message.timestamp
        isComplete = message.isComplete
    }

    public var chatMessage: ChatMessage {
        ChatMessage(
            id: id,
            kind: MessageKind(rawValue: kind) ?? .system,
            content: content,
            rawContent: rawContent,
            fromPeer: fromPeer,
            requestId: requestId,
            timestamp: timestamp,
            isComplete: isComplete
        )
    }
}

/// Transcript persistence: one JSON file per session plus a registry the sidebar reads.
///
/// Ports the semantics of `js/session/storage.js` (which used `localStorage`) onto the
/// file system, with the root injected so tests never touch Application Support.
public actor SessionStore {
    public struct Entry: Codable, Equatable, Sendable, Identifiable {
        public var id: String
        public var name: String
        public var createdAt: Date
        public var messageCount: Int
    }

    public let root: URL

    public init(root: URL) {
        self.root = root
    }

    private var registryURL: URL { root.appending(path: "registry.json") }

    private func sessionURL(_ id: String) -> URL {
        root.appending(path: "\(id).json")
    }

    public func ensureRoot() throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    /// Newest first. A corrupt registry is treated as empty: losing the index must not
    /// lose the session files, and it must not crash the app on launch.
    public func list() throws -> [Entry] {
        try ensureRoot()
        guard let data = try? Data(contentsOf: registryURL) else { return [] }
        let entries = (try? JSONDecoder().decode([Entry].self, from: data)) ?? []
        return entries.sorted { $0.createdAt > $1.createdAt }
    }

    public func save(_ session: StoredSession) throws {
        try ensureRoot()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(session).write(to: sessionURL(session.id), options: .atomic)

        var entries = try list().filter { $0.id != session.id }
        entries.append(Entry(
            id: session.id,
            name: session.name,
            createdAt: session.createdAt,
            messageCount: session.messages.count
        ))
        try encoder.encode(entries.sorted { $0.createdAt > $1.createdAt }).write(to: registryURL, options: .atomic)
    }

    public func load(id: String) throws -> StoredSession? {
        guard let data = try? Data(contentsOf: sessionURL(id)) else { return nil }
        return try? JSONDecoder().decode(StoredSession.self, from: data)
    }

    public func delete(id: String) throws {
        try? FileManager.default.removeItem(at: sessionURL(id))
        let remaining = try list().filter { $0.id != id }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(remaining).write(to: registryURL, options: .atomic)
    }

    public func search(_ query: String) throws -> [Entry] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return try list() }
        return try list().filter { $0.name.lowercased().contains(needle) }
    }
}
