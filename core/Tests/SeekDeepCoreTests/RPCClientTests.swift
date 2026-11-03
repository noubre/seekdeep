import XCTest
@testable import SeekDeepCore

/// Transport double: records what the client sends and lets the test push bytes back.
actor RecordingTransport: WorkletTransport {
    private(set) var sent: [String] = []
    private nonisolated let continuation: AsyncStream<Data>.Continuation
    nonisolated let inbound: AsyncStream<Data>

    init() {
        var captured: AsyncStream<Data>.Continuation!
        inbound = AsyncStream { captured = $0 }
        continuation = captured
    }

    func start() async throws {}
    func send(_ data: Data) async throws { sent.append(String(decoding: data, as: UTF8.self)) }
    func stop() async { continuation.finish() }

    nonisolated func push(_ line: String) { continuation.yield(Data(line.utf8)) }
}

/// Poll until `condition` is true, or fail after `timeout`. Keeps async tests free of
/// arbitrary sleeps without pulling in a dependency.
func waitUntil(
    timeout: Duration = .seconds(2),
    file: StaticString = #filePath,
    line: UInt = #line,
    _ condition: @escaping () async -> Bool
) async throws {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline {
        if await condition() { return }
        try await Task.sleep(for: .milliseconds(5))
    }
    XCTFail("condition not met within \(timeout)", file: file, line: line)
}

final class RPCClientTests: XCTestCase {
    func testRequestResolvesWithResult() async throws {
        let transport = RecordingTransport()
        let client = RPCClient(transport: transport)
        try await client.start()

        let task = Task { try await client.request("chat.status") }
        try await waitUntil { await transport.sent.count == 1 }
        // Extract before asserting: XCTest's @autoclosure parameters cannot await.
        let sent = await transport.sent
        XCTAssertEqual(sent.first, #"{"id":"1","method":"chat.status","params":{}}"# + "\n")

        transport.push(#"{"id":"1","ok":true,"result":{"role":"none"}}"# + "\n")
        let result = try await task.value
        XCTAssertEqual(result["role"]?.string, "none")
    }

    func testRequestThrowsWorkerError() async throws {
        let transport = RecordingTransport()
        let client = RPCClient(transport: transport)
        try await client.start()

        let task = Task { try await client.request("chat.send", ["prompt": .str("x"), "model": .str("m")]) }
        try await waitUntil { await transport.sent.count == 1 }
        transport.push(#"{"id":"1","ok":false,"error":"Not connected to a host"}"# + "\n")

        do {
            _ = try await task.value
            XCTFail("expected an error")
        } catch let error as RPCError {
            XCTAssertEqual(error.message, "Not connected to a host")
            XCTAssertNil(error.code)
        }
    }

    func testNotificationsArriveOnTheEventStream() async throws {
        let transport = RecordingTransport()
        let client = RPCClient(transport: transport)
        try await client.start()

        let received = Task { () -> String? in
            for await notification in client.notifications { return notification.name }
            return nil
        }
        transport.push(#"{"event":"chat.event","data":{"type":"status"}}"# + "\n")
        let name = await received.value
        XCTAssertEqual(name, "chat.event")
    }

    func testFrameSplitAcrossChunksIsReassembled() async throws {
        let transport = RecordingTransport()
        let client = RPCClient(transport: transport)
        try await client.start()

        let task = Task { try await client.request("chat.status") }
        try await waitUntil { await transport.sent.count == 1 }
        transport.push(#"{"id":"1","ok":true,"resu"#)
        transport.push(#"lt":{"role":"host"}}"# + "\n")

        let result = try await task.value
        XCTAssertEqual(result["role"]?.string, "host")
    }

    func testMalformedFramesAreIgnoredRatherThanFailingTheClient() async throws {
        let transport = RecordingTransport()
        let client = RPCClient(transport: transport)
        try await client.start()

        let task = Task { try await client.request("chat.status") }
        try await waitUntil { await transport.sent.count == 1 }
        transport.push("not json\n")
        transport.push(#"{"id":"1","ok":true,"result":{}}"# + "\n")

        let result = try await task.value
        XCTAssertEqual(result.object?.isEmpty, true)
    }

    func testRequestTimesOut() async throws {
        let transport = RecordingTransport()
        let client = RPCClient(transport: transport, timeout: .milliseconds(50))
        try await client.start()

        do {
            _ = try await client.request("chat.status")
            XCTFail("expected a timeout")
        } catch let error as RPCError {
            XCTAssertTrue(error.message.contains("timed out"), error.message)
        }
    }
}

final class SerialWriterTests: XCTestCase {
    func testConcurrentWritesNeverInterleave() async throws {
        let transport = RecordingTransport()
        let writer = SerialWriter(transport: transport)

        try await withThrowingTaskGroup(of: Void.self) { group in
            for index in 0..<10 {
                group.addTask { try await writer.send(Data("frame-\(index)\n".utf8)) }
            }
            try await group.waitForAll()
        }

        let frames = await transport.sent
        XCTAssertEqual(frames.count, 10)
        for frame in frames { XCTAssertTrue(frame.hasSuffix("\n")) }
    }
}
