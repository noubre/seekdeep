import XCTest
@testable import SeekDeepCore

final class SessionStoreTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appending(path: "seekdeep-sessions-\(UUID().uuidString)", directoryHint: .isDirectory)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func session(id: String, name: String, createdAt: TimeInterval = 0, messages: Int = 1) -> StoredSession {
        StoredSession(
            id: id,
            name: name,
            createdAt: Date(timeIntervalSince1970: createdAt),
            messages: (0..<messages).map { index in
                StoredMessage(ChatMessage(id: "\(id)-\(index)", kind: .user, content: "hello"))
            }
        )
    }

    func testRoundTrip() async throws {
        let store = SessionStore(root: root)
        try await store.save(session(id: "s1", name: "First"))

        let entries = try await store.list()
        XCTAssertEqual(entries.map(\.id), ["s1"])
        XCTAssertEqual(entries.first?.messageCount, 1)

        let loaded = try await store.load(id: "s1")
        XCTAssertEqual(loaded?.name, "First")
        XCTAssertEqual(loaded?.messages.count, 1)
        XCTAssertEqual(loaded?.messages.first?.chatMessage.content, "hello")
    }

    func testListIsNewestFirst() async throws {
        let store = SessionStore(root: root)
        try await store.save(session(id: "old", name: "Old", createdAt: 100))
        try await store.save(session(id: "new", name: "New", createdAt: 200))
        let entries = try await store.list()
        XCTAssertEqual(entries.map(\.id), ["new", "old"])
    }

    func testSaveTwiceReplacesTheEntryRatherThanDuplicatingIt() async throws {
        let store = SessionStore(root: root)
        try await store.save(session(id: "s1", name: "First"))
        try await store.save(session(id: "s1", name: "First", messages: 3))
        let entries = try await store.list()
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries.first?.messageCount, 3)
    }

    func testDeleteRemovesFileAndEntry() async throws {
        let store = SessionStore(root: root)
        try await store.save(session(id: "s1", name: "First"))
        try await store.delete(id: "s1")

        let entries = try await store.list()
        XCTAssertEqual(entries, [])
        let missing = try await store.load(id: "s1")
        XCTAssertNil(missing)
    }

    func testSearchMatchesNamesCaseInsensitively() async throws {
        let store = SessionStore(root: root)
        try await store.save(session(id: "s1", name: "Morning standup"))
        try await store.save(session(id: "s2", name: "Evening debug"))

        let found = try await store.search("STAND")
        XCTAssertEqual(found.map(\.id), ["s1"])
    }

    func testCorruptRegistryIsTreatedAsEmpty() async throws {
        let store = SessionStore(root: root)
        try await store.ensureRoot()
        try Data("not json".utf8).write(to: root.appending(path: "registry.json"))

        let entries = try await store.list()
        XCTAssertEqual(entries, [], "a corrupt index must not take the app down on launch")
    }

    func testEmptyStoreListsNothing() async throws {
        let store = SessionStore(root: root)
        let entries = try await store.list()
        XCTAssertEqual(entries, [])
    }

    func testRenameTrimsAndPersistsTheNewName() async throws {
        let store = SessionStore(root: root)
        try await store.save(session(id: "s1", name: "First", messages: 3))

        let renamed = try await store.rename(id: "s1", name: "  Renamed  ")
        XCTAssertEqual(renamed?.id, "s1")
        XCTAssertEqual(renamed?.name, "Renamed")
        XCTAssertEqual(renamed?.messageCount, 3)

        let entries = try await store.list()
        XCTAssertEqual(entries.map(\.name), ["Renamed"], "the registry carries the new name")
        let loaded = try await store.load(id: "s1")
        XCTAssertEqual(loaded?.name, "Renamed", "the session file carries the new name")
    }

    func testRenameIgnoresAnEmptyName() async throws {
        let store = SessionStore(root: root)
        try await store.save(session(id: "s1", name: "First"))

        let renamed = try await store.rename(id: "s1", name: "   ")
        XCTAssertEqual(renamed?.name, "First", "whitespace-only names leave the session alone")
        let entries = try await store.list()
        XCTAssertEqual(entries.map(\.name), ["First"])
    }

    func testRenameOfAnUnknownIdReturnsNil() async throws {
        let store = SessionStore(root: root)
        let renamed = try await store.rename(id: "missing", name: "Whatever")
        XCTAssertNil(renamed)
    }

    // MARK: - at-rest encryption

    private func encryptedStore() -> SessionStore {
        SessionStore(root: root, keys: InMemorySessionKey(bytes: Data(repeating: 9, count: 32)))
    }

    func testEncryptedBodyOnDiskDoesNotContainTheTranscript() async throws {
        let marker = "SEEKDEEP-PLAINTEXT-MARKER-7f3a"
        let store = encryptedStore()
        let original = StoredSession(
            id: "s1",
            name: "Secret",
            createdAt: Date(timeIntervalSince1970: 0),
            messages: [StoredMessage(ChatMessage(id: "m1", kind: .user, content: marker))]
        )
        try await store.save(original)

        let raw = try Data(contentsOf: root.appending(path: "s1.json"))
        XCTAssertTrue(SessionCrypto.isSealed(raw), "the session body is the sealed envelope")
        XCTAssertNil(String(data: raw, encoding: .utf8)?.range(of: marker), "the transcript text must not be on disk")
        // The registry stays plaintext on purpose.
        let registry = try Data(contentsOf: root.appending(path: "registry.json"))
        XCTAssertEqual(try JSONDecoder().decode([SessionStore.Entry].self, from: registry).first?.name, "Secret")
    }

    func testEncryptedSaveLoadRoundTrip() async throws {
        let store = encryptedStore()
        let original = session(id: "s1", name: "First", createdAt: 100, messages: 3)
        try await store.save(original)
        let loaded = try await store.load(id: "s1")
        XCTAssertEqual(loaded, original)
    }

    func testLegacyPlaintextBodyIsReadAndRewrittenSealed() async throws {
        let original = session(id: "s1", name: "First", messages: 2)
        try await SessionStore(root: root).save(original)
        let url = root.appending(path: "s1.json")
        XCTAssertFalse(SessionCrypto.isSealed(try Data(contentsOf: url)), "precondition: written plaintext")

        let loaded = try await encryptedStore().load(id: "s1")
        XCTAssertEqual(loaded, original)

        let after = try Data(contentsOf: url)
        XCTAssertTrue(SessionCrypto.isSealed(after), "the next launch must already be migrated")
        XCTAssertNil(String(data: after, encoding: .utf8)?.range(of: "hello"), "the rewrite actually sealed the body")
    }

    func testCorruptBodyReturnsNilRatherThanThrowing() async throws {
        let store = encryptedStore()
        try await store.ensureRoot()
        try Data("not json".utf8).write(to: root.appending(path: "s1.json"))
        let loaded = try await store.load(id: "s1")
        XCTAssertNil(loaded)
    }

    func testSealedBodyOpenedWithTheWrongKeyReturnsNil() async throws {
        try await SessionStore(root: root, keys: InMemorySessionKey(bytes: Data(repeating: 9, count: 32)))
            .save(session(id: "s1", name: "First"))
        let other = SessionStore(root: root, keys: InMemorySessionKey(bytes: Data(repeating: 8, count: 32)))
        let loaded = try await other.load(id: "s1")
        XCTAssertNil(loaded, "a wrong key must not yield garbage")
    }
}
