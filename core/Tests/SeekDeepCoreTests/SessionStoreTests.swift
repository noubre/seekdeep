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
}
