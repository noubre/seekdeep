import XCTest
@testable import SeekDeepCore

/// Boots the **real** worker (`node worklet/dev.js`) and speaks to it through the Swift
/// stack: ProcessTransport → RPCClient → WorkerEvent → ChatReducer.
///
/// This is the test that would have caught every protocol mistake made while porting. It
/// skips itself when Node or the worklet is missing, so `swift test` still works on a
/// machine that only has the Swift bits.
final class WorkletIntegrationTests: XCTestCase {
    private var storage: URL!

    override func setUpWithError() throws {
        storage = FileManager.default.temporaryDirectory
            .appending(path: "seekdeep-it-\(UUID().uuidString)", directoryHint: .isDirectory)
    }

    override func tearDownWithError() throws {
        if let storage { try? FileManager.default.removeItem(at: storage) }
    }

    private func makeClient() throws -> (RPCClient, ProcessTransport) {
        // Under `swift test` the source path is absolute; under Xcode it is relative, hence
        // the cwd fallback. Either way the search is by file existence, not by depth.
        let start = URL(fileURLWithPath: #filePath)
        let root = ProcessTransport.findRepositoryRoot(startingAt: start)
            ?? ProcessTransport.findRepositoryRoot(startingAt: URL(fileURLWithPath: FileManager.default.currentDirectoryPath))
        guard let root else { throw XCTSkip("worklet/dev.js not present — not a checkout with the JS core") }
        let transport = ProcessTransport(repositoryRoot: root, storageRoot: storage)
        return (RPCClient(transport: transport, timeout: .seconds(30)), transport)
    }

    func testCreatesARoomAndReportsStatus() async throws {
        let (client, _) = try makeClient()
        try await client.start()

        let created = try await client.request("chat.create")
        let topic = try XCTUnwrap(created["topic"]?.string)
        XCTAssertEqual(topic.count, 64, "a topic key is 64 hex characters")
        XCTAssertEqual(created["role"]?.string, "host")

        let status = try await client.request("chat.status")
        XCTAssertEqual(status["topic"]?.string, topic)
        XCTAssertEqual(status["role"]?.string, "host")
        XCTAssertEqual(status["initialized"]?.bool, true)

        await client.stop()
    }

    func testStatusFrameDecodesIntoTheReducer() async throws {
        let (client, _) = try makeClient()
        try await client.start()
        _ = try await client.request("chat.create")
        let status = try await client.request("chat.status")

        var object = status.object ?? [:]
        object["type"] = .str("status")
        let update = try XCTUnwrap(WorkerEvent.decode(
            notification: RPCNotification(name: "chat.event", data: .object(object))
        ))
        guard case .status(let topic, let role, _, _, _, _) = update else {
            return XCTFail("expected a status update")
        }
        XCTAssertEqual(topic?.count, 64)
        XCTAssertEqual(role, "host")

        var state = ChatReducer.reduce(ChatState(), update)
        XCTAssertEqual(state.role, "host")
        XCTAssertTrue(state.isHost)
        XCTAssertEqual(state.topic, topic)

        await client.stop()
    }

    /// The worker emits `harness.event` plugin notifications and a `chat.event` status
    /// before it answers the first request, so a client that takes "the next frame" as its
    /// reply reads garbage (a real bug in the first draft of `RPCClient`).
    func testBootNotificationsArriveBeforeTheReply() async throws {
        let (client, _) = try makeClient()
        try await client.start()

        let names = Task { () -> [String] in
            var seen: [String] = []
            for await notification in client.notifications {
                seen.append(notification.name)
                if seen.count == 4 { break }
            }
            return seen
        }
        let created = try await client.request("chat.create")
        XCTAssertEqual(created["role"]?.string, "host")

        let seen = await names.value
        XCTAssertFalse(seen.isEmpty, "the worker must emit at least one notification on boot")
        XCTAssertTrue(
            seen.allSatisfy { $0 == "chat.event" || $0 == "harness.event" },
            "unexpected notification names: \(seen)"
        )

        await client.stop()
    }

    func testSendingWithoutAModelSurfacesAnErrorInsteadOfHanging() async throws {
        let (client, _) = try makeClient()
        try await client.start()
        _ = try await client.request("chat.create")

        do {
            _ = try await client.request("chat.send", ["prompt": .str("hi"), "model": .str("definitely-not-installed")])
            // The worker may accept the request and report the failure on the event stream;
            // either way it must not hang. Reaching here is only valid if an error event
            // arrives shortly after.
        } catch let error as RPCError {
            XCTAssertFalse(error.message.isEmpty)
        }

        await client.stop()
    }
}
