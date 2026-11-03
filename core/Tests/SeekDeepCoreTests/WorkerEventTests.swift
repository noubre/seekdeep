import XCTest
@testable import SeekDeepCore

final class WorkerEventTests: XCTestCase {
    private func chat(_ json: String) throws -> WorkerUpdate? {
        WorkerEvent.decode(notification: RPCNotification(name: "chat.event", data: try decode(json)))
    }

    private func harness(_ json: String) throws -> WorkerUpdate? {
        WorkerEvent.decode(notification: RPCNotification(name: "harness.event", data: try decode(json)))
    }

    private func decode(_ json: String) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
    }

    func testStatusEvent() throws {
        let event = try XCTUnwrap(WorkerEvent.decode(notification: RPCNotification(
            name: "chat.event",
            data: try decode(#"{"type":"status","role":"host","connected":true,"peerCount":2,"collaborative":true,"provider":"ollama"}"#)
        )))
        XCTAssertEqual(event, .status(topic: nil, role: "host", connected: true, peerCount: 2, collaborative: true, provider: "ollama"))
    }

    func testMessageTimestampIsMilliseconds() throws {
        let event = try XCTUnwrap(chat(#"{"type":"message","message":{"id":"m1","type":"system","content":"Reading an existing chat session…","fromPeer":"Host","timestamp":1700000000000}}"#))
        guard case .message(let message) = event else { return XCTFail("expected a message") }
        XCTAssertEqual(message.id, "m1")
        XCTAssertEqual(message.kind, .system)
        XCTAssertEqual(message.content, "Reading an existing chat session…")
        XCTAssertEqual(message.fromPeer, "Host")
        XCTAssertEqual(message.timestamp.timeIntervalSince1970, 1_700_000_000, accuracy: 0.001)
    }

    func testResponseEvent() throws {
        let event = try XCTUnwrap(chat(#"{"type":"response","requestId":"r-1","chunk":"Hel","done":false}"#))
        XCTAssertEqual(event, .response(requestId: "r-1", chunk: "Hel", done: false, error: nil))
    }

    func testResponseErrorEvent() throws {
        let event = try XCTUnwrap(chat(#"{"type":"response","requestId":"r-1","chunk":"","done":true,"error":"fetch failed"}"#))
        XCTAssertEqual(event, .response(requestId: "r-1", chunk: "", done: true, error: "fetch failed"))
    }

    func testPeersAndModels() throws {
        let peers = try XCTUnwrap(chat(#"{"type":"peers","peers":[{"id":"ab12","displayName":"Ada","role":"host"}]}"#))
        XCTAssertEqual(peers, .peers([WirePeer(id: "ab12", displayName: "Ada", role: "host")]))

        let models = try XCTUnwrap(chat(#"{"type":"models","provider":"lmstudio","models":[{"id":"qwen3:8b","name":"Qwen 3"}]}"#))
        XCTAssertEqual(models, .models(provider: "lmstudio", models: [WireModel(id: "qwen3:8b", name: "Qwen 3")]))
    }

    func testHarnessSlashEvent() throws {
        let event = try XCTUnwrap(harness(#"{"type":"slash","content":"/p2p drive create work","metadata":{"kind":"slash-error","command":"p2p","action":"drive"}}"#))
        XCTAssertEqual(event, .slash(content: "/p2p drive create work", kind: "slash-error"))
    }

    func testHarnessBotEvent() throws {
        let event = try XCTUnwrap(harness(#"{"type":"bot","kind":"reply","text":"ok","fromName":"peerA"}"#))
        XCTAssertEqual(event, .bot(kind: "reply", text: "ok", from: "peerA"))
    }

    func testUnknownTypesAreIgnored() throws {
        XCTAssertNil(try chat(#"{"type":"chat_response","requestId":"r-1","kind":"text"}"#))
        XCTAssertNil(try harness(#"{"type":"plugin","status":"loaded"}"#))
        XCTAssertNil(WorkerEvent.decode(notification: RPCNotification(name: "other.event", data: .null)))
    }
}
