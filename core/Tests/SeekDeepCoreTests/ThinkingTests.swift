import XCTest
@testable import SeekDeepCore

final class ThinkingTests: XCTestCase {
    private let open = "<" + "think>"
    private let close = "<" + "/think>"

    func testSplitsPlainReply() {
        let result = Thinking.split("hello")
        XCTAssertEqual(result.answer, "hello")
        XCTAssertEqual(result.thinking, "")
        XCTAssertFalse(result.open)
    }

    func testSplitsTaggedBlock() {
        let input = "answer " + open + "reasoning" + close + " tail"
        let result = Thinking.split(input)
        XCTAssertEqual(result.answer, "answer  tail")
        XCTAssertEqual(result.thinking, "reasoning")
        XCTAssertFalse(result.open)
    }

    func testLastBlockWins() {
        let input = open + "one" + close + "mid" + open + "two" + close
        let result = Thinking.split(input)
        XCTAssertEqual(result.thinking, "two")
        XCTAssertEqual(result.answer, "mid")
    }

    func testUnterminatedBlockIsOpenAndExcludedFromAnswer() {
        let input = "visible" + open + "still going"
        let result = Thinking.split(input)
        XCTAssertEqual(result.answer, "visible")
        XCTAssertEqual(result.thinking, "still going")
        XCTAssertTrue(result.open, "an open block is what keeps half-written reasoning out of the bubble")
    }
}
