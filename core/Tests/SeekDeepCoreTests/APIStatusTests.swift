import XCTest
@testable import SeekDeepCore

final class APIStatusTests: XCTestCase {
    private func decode(_ json: String) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
    }

    func testDecodesRunningAndOffPayloads() throws {
        let running = try XCTUnwrap(APIStatus(json: try decode(
            #"{"running":true,"mode":"server","model":null,"host":"127.0.0.1","port":8080,"url":"http://127.0.0.1:8080/v1","auth":true}"#
        )))
        XCTAssertEqual(running, APIStatus(running: true, mode: "server", url: "http://127.0.0.1:8080/v1", port: 8080, auth: true))

        let off = try XCTUnwrap(APIStatus(json: try decode(#"{"running":false}"#)))
        XCTAssertEqual(off, .off)
        XCTAssertNil(APIStatus(json: try decode(#"{"mode":"server"}"#)), "a payload without `running` is not a status")
    }
}
