import XCTest
@testable import SeekDeepCore

final class JSONValueTests: XCTestCase {
    func testDecodesNestedDocument() throws {
        let json = #"{"a":[1,2.5,true,null,"s"],"b":{"c":false}}"#
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        XCTAssertEqual(value["b"]?["c"], .bool(false))
        XCTAssertEqual(value["a"]?.array?.count, 5)
        XCTAssertEqual(value["a"]?.array?[0], .number(1))
        XCTAssertEqual(value["a"]?.array?[2], .bool(true))
        XCTAssertEqual(value["a"]?.array?[3], .null)
        XCTAssertEqual(value["a"]?.array?[0].int, 1)
        XCTAssertNil(value["a"]?.array?[1].int, "2.5 is not a whole number")
    }

    func testRoundTripsThroughEncoder() throws {
        let value: JSONValue = .object(["t": .string("x"), "n": .number(1), "a": .array([.bool(true)])])
        let data = try JSONEncoder().encode(value)
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: data), value)
    }

    func testSubscriptOnNonObjectIsNil() {
        XCTAssertNil(JSONValue.number(1)["missing"])
        XCTAssertNil(JSONValue.null.string)
    }

    func testWholeNumbersNarrowToInt() {
        XCTAssertEqual(JSONValue.number(1_700_000_000_000).int, 1_700_000_000_000)
        XCTAssertNil(JSONValue.number(1.5).int)
        XCTAssertNil(JSONValue.number(-1).int, "-1 is whole but the accessor is used for counts; guard at the call site")
    }
}
