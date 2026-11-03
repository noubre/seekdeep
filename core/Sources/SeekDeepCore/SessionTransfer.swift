import Foundation

/// Move a `StoredSession` through a `.json` file without changing the on-disk schema
/// Phase 9 will encrypt. `decode` is stricter than `SessionStore.load` because an
/// imported file is untrusted input: a hostile `id` must not become a path.
public struct SessionTransfer {
    /// Pretty, sorted JSON so a re-export of the same session is a stable diff.
    public static func encode(_ session: StoredSession) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(session)
    }

    /// Decodes a full `StoredSession`. Missing message fields throw (the Codable shape is
    /// already all-or-nothing); an empty id, or an id containing a path separator or
    /// `..`, throws before the caller can turn it into a filename.
    public static func decode(_ data: Data) throws -> StoredSession {
        let session = try JSONDecoder().decode(StoredSession.self, from: data)
        try validateID(session.id)
        return session
    }

    /// Saves `session`, never overwriting. If `id` is already taken, the imported copy
    /// gets a fresh lowercase UUID id and its name suffixed `" (imported)"`; the original
    /// file and registry entry are untouched.
    public static func importInto(_ store: SessionStore, session: StoredSession) async throws -> StoredSession {
        try validateID(session.id)
        // `SessionStore` is an actor, so this cannot be the synchronous `throws` the
        // brief sketched without adding a nonisolated store API nothing else needs.
        if try await store.load(id: session.id) != nil {
            let imported = StoredSession(
                id: UUID().uuidString.lowercased(),
                name: session.name + " (imported)",
                createdAt: session.createdAt,
                messages: session.messages
            )
            try await store.save(imported)
            return imported
        }
        try await store.save(session)
        return session
    }

    private static func validateID(_ id: String) throws {
        if id.isEmpty {
            throw DecodingError.dataCorrupted(.init(
                codingPath: [],
                debugDescription: "session id must not be empty"
            ))
        }
        if id.contains("/") || id.contains("\\") || id.contains("..") {
            throw DecodingError.dataCorrupted(.init(
                codingPath: [],
                debugDescription: "session id must not contain path separators or '..'"
            ))
        }
    }
}
