import XCTest
@testable import SeekDeepCore

final class MarkdownBlockTests: XCTestCase {
    func testPlainParagraph() {
        XCTAssertEqual(MarkdownBlock.parse("hello"), [.paragraph("hello")])
    }

    func testFencedCodeIsItsOwnBlockAndNotAParagraph() {
        let blocks = MarkdownBlock.parse("before\n\n```swift\nlet x = 1\n```\n\nafter")
        XCTAssertEqual(blocks, [
            .paragraph("before"),
            .code("let x = 1"),
            .paragraph("after")
        ])
    }

    func testUnclosedFenceWhileStreamingStillRendersAsCode() {
        XCTAssertEqual(MarkdownBlock.parse("```js\nconst a = 1"), [.code("const a = 1")])
    }

    func testHeading() {
        XCTAssertEqual(MarkdownBlock.parse("# Title"), [.heading(level: 1, text: "Title")])
        XCTAssertEqual(MarkdownBlock.parse("### Deep"), [.heading(level: 3, text: "Deep")])
    }

    func testBulletList() {
        XCTAssertEqual(MarkdownBlock.parse("- one\n- two"), [.bulletList(["one", "two"])])
        XCTAssertEqual(MarkdownBlock.parse("* one\n* two"), [.bulletList(["one", "two"])])
    }

    func testMultipleLinesStayInOneParagraph() {
        XCTAssertEqual(MarkdownBlock.parse("line one\nline two"), [.paragraph("line one\nline two")])
    }

    func testCodeBlockIsNotSplitByBlankLines() {
        let blocks = MarkdownBlock.parse("```\na\n\nb\n```")
        XCTAssertEqual(blocks, [.code("a\n\nb")])
    }

    func testEmptyInputProducesNoBlocks() {
        XCTAssertEqual(MarkdownBlock.parse(""), [])
        XCTAssertEqual(MarkdownBlock.parse("\n\n"), [])
    }
}

final class SlashQueryTests: XCTestCase {
    func testCommandWithoutArguments() {
        XCTAssertEqual(SlashQuery.command(in: "/models", caret: 7), "models")
    }

    func testNilOnceTheFirstTokenIsFollowedBySpace() {
        XCTAssertNil(SlashQuery.command(in: "/p2p drive", caret: 10))
    }

    func testNilForPlainProse() {
        XCTAssertNil(SlashQuery.command(in: "hello /p2p", caret: 10))
        XCTAssertNil(SlashQuery.command(in: "", caret: 0))
    }

    func testBareSlashMatchesEverything() {
        XCTAssertEqual(SlashQuery.command(in: "/", caret: 1), "")
    }

    func testMatchesFiltersByPrefixCaseInsensitively() {
        let commands = ["p2p", "models", "model", "status"]
        XCTAssertEqual(SlashQuery.matches(commands, query: "mod"), ["models", "model"])
        XCTAssertEqual(SlashQuery.matches(commands, query: ""), commands)
    }
}

final class TranscriptTests: XCTestCase {
    func testMarkdownContainsSpeakerTimeAndBody() {
        let message = ChatMessage(
            id: "m1",
            kind: .assistant,
            content: "hello",
            fromPeer: "Host",
            timestamp: Date(timeIntervalSince1970: 0)
        )
        let output = Transcript.markdown([message], topic: "abc123", date: Date(timeIntervalSince1970: 0))
        XCTAssertTrue(output.contains("# SeekDeep transcript"))
        XCTAssertTrue(output.contains("Topic: `abc123`"))
        XCTAssertTrue(output.contains("## Host — 1970-01-01 00:00:00 UTC"))
        XCTAssertTrue(output.contains("hello"))
    }

    func testReasoningIsStrippedFromTheExportedBody() {
        let open = "<" + "think>"
        let close = "<" + "/think>"
        let message = ChatMessage(
            id: "m1",
            kind: .assistant,
            content: "answer",
            rawContent: "answer" + open + "secret" + close,
            timestamp: Date(timeIntervalSince1970: 0)
        )
        let output = Transcript.markdown([message], topic: nil)
        XCTAssertTrue(output.contains("answer"))
        XCTAssertFalse(output.contains("secret"))
    }
}
