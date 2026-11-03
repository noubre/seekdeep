import XCTest
@testable import SeekDeepCore

final class PromptRecallTests: XCTestCase {
    func testEmptyHistoryReturnsNilFromPrevious() {
        var recall = PromptRecall()
        XCTAssertTrue(recall.history.isEmpty)
        XCTAssertNil(recall.previous(draft: "anything"))
        XCTAssertNil(recall.next(draft: "anything"))
        XCTAssertNil(recall.index)
        XCTAssertEqual(recall.stash, "")
    }

    func testPreviousReturnsNewestMiddleOldestAndStops() {
        var recall = PromptRecall()
        recall.record("oldest")
        recall.record("middle")
        recall.record("newest")
        XCTAssertEqual(recall.previous(draft: "user was typing"), "newest")
        XCTAssertEqual(recall.previous(draft: "newest"), "middle")
        XCTAssertEqual(recall.previous(draft: "middle"), "oldest")
        XCTAssertEqual(recall.previous(draft: "oldest"), "oldest", "further ups stay on the oldest entry")
        XCTAssertEqual(recall.index, 0)
        XCTAssertEqual(recall.stash, "user was typing")
    }

    func testNextWalksForwardThenRestoresStashAndStopsBrowsing() {
        var recall = PromptRecall()
        recall.record("one")
        recall.record("two")
        recall.record("three")
        XCTAssertEqual(recall.previous(draft: "in progress"), "three")
        XCTAssertEqual(recall.previous(draft: "three"), "two")
        XCTAssertEqual(recall.previous(draft: "two"), "one")
        XCTAssertEqual(recall.next(draft: "one"), "two")
        XCTAssertEqual(recall.next(draft: "two"), "three")
        XCTAssertEqual(recall.next(draft: "three"), "in progress")
        XCTAssertNil(recall.index)
        XCTAssertEqual(recall.stash, "in progress")
        XCTAssertNil(recall.next(draft: ""), "browsing is off, so next is a no-op")
        XCTAssertEqual(recall.previous(draft: "fresh"), "three", "a new browse starts from the newest again")
    }

    func testBlankDraftsAreIgnoredAndConsecutiveDuplicatesCollapse() {
        var recall = PromptRecall()
        recall.record("")
        recall.record("   ")
        recall.record("\n\t")
        recall.record("hello")
        recall.record("hello")
        recall.record("hello")
        recall.record("world")
        recall.record("hello")
        XCTAssertEqual(recall.history, ["hello", "world", "hello"], "only immediate duplicates collapse")
    }

    func testRecordWhileBrowsingResetsIndexAndStash() {
        var recall = PromptRecall()
        recall.record("a")
        recall.record("b")
        XCTAssertEqual(recall.previous(draft: "draft"), "b")
        XCTAssertEqual(recall.index, 1)
        XCTAssertEqual(recall.stash, "draft")
        recall.record("c")
        XCTAssertNil(recall.index)
        XCTAssertEqual(recall.stash, "")
        XCTAssertEqual(recall.previous(draft: "draft2"), "c")
        XCTAssertEqual(recall.stash, "draft2")
    }

    func testCapAtFiftyDropsOldest() {
        var recall = PromptRecall()
        for i in 0..<55 {
            recall.record("prompt-\(i)")
        }
        XCTAssertEqual(recall.history.count, 50)
        XCTAssertEqual(recall.history.first, "prompt-5")
        XCTAssertEqual(recall.history.last, "prompt-54")
        XCTAssertEqual(recall.previous(draft: ""), "prompt-54")
    }
}
