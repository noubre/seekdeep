import XCTest
@testable import SeekDeepCore

final class RPCFrameTests: XCTestCase {
    func testEncodesRequestWithExactlyThreeKeysAndTrailingNewline() throws {
        let data = try RPCFrame.encodeRequest(id: "7", method: "chat.send", params: ["prompt": .str("hi")])
        XCTAssertEqual(data.last, 0x0A)
        let text = String(decoding: data.dropLast(), as: UTF8.self)
        let object = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]
        XCTAssertEqual(Set(object?.keys.map { $0 } ?? []), ["id", "method", "params"])
        XCTAssertEqual(object?["id"] as? String, "7")
        XCTAssertEqual(object?["method"] as? String, "chat.send")
    }

    func testDecodesResponse() throws {
        let line = Data(#"{"id":"1","ok":true,"result":{"role":"host"}}"#.utf8)
        XCTAssertEqual(try RPCFrame(line: line), .response(id: "1", result: .object(["role": .string("host")])))
    }

    func testDecodesStringError() throws {
        let line = Data(#"{"id":"2","ok":false,"error":"Only the host can set the mode"}"#.utf8)
        XCTAssertEqual(
            try RPCFrame(line: line),
            .failure(id: "2", error: RPCError(message: "Only the host can set the mode"))
        )
    }

    func testDecodesCodedError() throws {
        let line = Data(#"{"id":"3","ok":false,"error":{"code":"LOCALDRIVE_GET_FAILED","message":"nope"}}"#.utf8)
        XCTAssertEqual(
            try RPCFrame(line: line),
            .failure(id: "3", error: RPCError(message: "nope", code: "LOCALDRIVE_GET_FAILED"))
        )
    }

    func testDecodesEvent() throws {
        let line = Data(#"{"event":"chat.event","data":{"type":"status"}}"#.utf8)
        XCTAssertEqual(
            try RPCFrame(line: line),
            .notification(RPCNotification(name: "chat.event", data: .object(["type": .string("status")])))
        )
    }

    func testAcceptsIntegerIds() throws {
        let line = Data(#"{"id":9,"ok":true,"result":{}}"#.utf8)
        XCTAssertEqual(try RPCFrame(line: line), .response(id: "9", result: .object([:])))
    }

    func testRejectsExtraKeysAndUnknownShapes() {
        XCTAssertThrowsError(try RPCFrame(line: Data(#"{"id":"1","ok":true,"result":{},"extra":1}"#.utf8)))
        XCTAssertThrowsError(try RPCFrame(line: Data(#"{"nope":1}"#.utf8)))
        XCTAssertThrowsError(try RPCFrame(line: Data("not json".utf8)))
        XCTAssertThrowsError(try RPCFrame(line: Data(#"{"id":"1","ok":false,"error":42}"#.utf8)))
        XCTAssertThrowsError(try RPCFrame(line: Data(#"{"event":"Bad Name","data":{}}"#.utf8)))
        XCTAssertThrowsError(try RPCFrame(line: Data(#"[]"#.utf8)))
    }

    func testRejectsEmptyAndOversizedIds() {
        XCTAssertThrowsError(try RPCFrame.encodeRequest(id: "", method: "x", params: [:]))
        XCTAssertThrowsError(try RPCFrame.encodeRequest(id: String(repeating: "a", count: 65), method: "x", params: [:]))
    }
}
