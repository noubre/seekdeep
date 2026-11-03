import XCTest
@testable import SeekDeepCore

final class SessionTransferTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appending(path: "seekdeep-transfer-\(UUID().uuidString)", directoryHint: .isDirectory)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func session(id: String, name: String, createdAt: TimeInterval = 0, messages: Int = 2) -> StoredSession {
        StoredSession(
            id: id,
            name: name,
            createdAt: Date(timeIntervalSince1970: createdAt),
            messages: (0..<messages).map { index in
                StoredMessage(ChatMessage(
                    id: "\(id)-\(index)",
                    kind: index.isMultiple(of: 2) ? .user : .assistant,
                    content: "line \(index)",
                    rawContent: "raw \(index)",
                    fromPeer: index == 0 ? "You" : nil,
                    timestamp: Date(timeIntervalSince1970: Double(index))
                ))
            }
        )
    }

    func testRoundTripPreservesMessagesAndName() throws {
        let original = session(id: "s1", name: "Morning standup", createdAt: 100, messages: 3)
        let decoded = try SessionTransfer.decode(try SessionTransfer.encode(original))
        XCTAssertEqual(decoded, original)
    }

    func testMalformedJSONThrows() {
        XCTAssertThrowsError(try SessionTransfer.decode(Data("not json".utf8)))
        XCTAssertThrowsError(try SessionTransfer.decode(Data("[]".utf8)))
        XCTAssertThrowsError(try SessionTransfer.decode(Data("{\"id\":\"s1\"}".utf8)))
    }

    func testEmptyIDThrows() throws {
        let data = try SessionTransfer.encode(session(id: "s1", name: "x"))
        // Replace the id rather than constructing an invalid StoredSession by hand.
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        var mutated = object
        mutated["id"] = ""
        let empty = try XCTUnwrap(try? JSONSerialization.data(withJSONObject: mutated))
        XCTAssertThrowsError(try SessionTransfer.decode(empty))
    }

    func testIDWithPathSeparatorsOrDotDotThrows() throws {
        for bad in ["../escape", "foo/bar", "foo\\bar", "..", "a/../b", "..hidden"] {
            let data = try SessionTransfer.encode(session(id: "s1", name: "x"))
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            var mutated = object
            mutated["id"] = bad
            let payload = try XCTUnwrap(try? JSONSerialization.data(withJSONObject: mutated))
            XCTAssertThrowsError(try SessionTransfer.decode(payload), "id \(bad) must be rejected")
        }
    }

    func testIncompleteMessageThrows() throws {
        let data = try SessionTransfer.encode(session(id: "s1", name: "x", messages: 1))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        var messages = try XCTUnwrap(object["messages"] as? [[String: Any]])
        messages[0].removeValue(forKey: "isComplete")
        var mutated = object
        mutated["messages"] = messages
        let payload = try XCTUnwrap(try? JSONSerialization.data(withJSONObject: mutated))
        XCTAssertThrowsError(try SessionTransfer.decode(payload))
    }

    func testImportOfANewSessionSavesItAsIs() async throws {
        let store = SessionStore(root: root)
        let original = session(id: "s1", name: "Fresh", createdAt: 5, messages: 2)
        let stored = try await SessionTransfer.importInto(store, session: original)
        XCTAssertEqual(stored, original)

        let loaded = try await store.load(id: "s1")
        XCTAssertEqual(loaded, original)
        let entries = try await store.list()
        XCTAssertEqual(entries.map(\.id), ["s1"])
        XCTAssertEqual(entries.first?.name, "Fresh")
    }

    func testImportOverExistingIDCreatesASecondSessionAndLeavesTheOriginal() async throws {
        let store = SessionStore(root: root)
        let original = session(id: "dup", name: "Original", createdAt: 100, messages: 2)
        try await store.save(original)

        let incoming = session(id: "dup", name: "Original", createdAt: 200, messages: 5)
        let imported = try await SessionTransfer.importInto(store, session: incoming)

        XCTAssertNotEqual(imported.id, "dup")
        XCTAssertEqual(imported.name, "Original (imported)")
        XCTAssertEqual(imported.createdAt, incoming.createdAt)
        XCTAssertEqual(imported.messages, incoming.messages)

        let entries = try await store.list()
        XCTAssertEqual(entries.count, 2)
        XCTAssertEqual(Set(entries.map(\.id)), Set([original.id, imported.id]))

        // The pre-existing session is byte-for-byte the same session.
        let untouched = try await store.load(id: "dup")
        XCTAssertEqual(untouched, original)
        XCTAssertEqual(entries.first { $0.id == "dup" }?.messageCount, 2)
        XCTAssertEqual(entries.first { $0.id == imported.id }?.messageCount, 5)
    }

    func testImportedNameIsSuffixedEvenWhenTheIncomingNameIsDifferent() async throws {
        let store = SessionStore(root: root)
        try await store.save(session(id: "dup", name: "Original"))
        let imported = try await SessionTransfer.importInto(store, session: session(id: "dup", name: "Other"))
        XCTAssertEqual(imported.name, "Other (imported)")
    }
}
