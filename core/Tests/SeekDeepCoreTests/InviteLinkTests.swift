import XCTest
@testable import SeekDeepCore

final class InviteLinkTests: XCTestCase {
    /// 64 lowercase hex characters, the same shape the worker mints.
    private let topic = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

    func testRoundTrip() throws {
        let url = try XCTUnwrap(InviteLink.url(forTopic: topic))
        XCTAssertEqual(url.absoluteString, "seekdeep://join/\(topic)")
        XCTAssertEqual(InviteLink.topic(from: url), topic)
    }

    func testUppercaseTopicIsAcceptedAndLowercased() throws {
        let url = try XCTUnwrap(InviteLink.url(forTopic: topic.uppercased()))
        XCTAssertEqual(url.absoluteString, "seekdeep://join/\(topic)")
        XCTAssertEqual(InviteLink.topic(from: url), topic)
        XCTAssertEqual(InviteLink.topic(from: URL(string: "seekdeep://join/\(topic.uppercased())")!), topic)
    }

    func testTrailingSlashIsAccepted() {
        XCTAssertEqual(InviteLink.topic(from: URL(string: "seekdeep://join/\(topic)/")!), topic)
    }

    func testQueryFormIsAccepted() {
        XCTAssertEqual(InviteLink.topic(from: URL(string: "seekdeep://join?topic=\(topic)")!), topic)
        XCTAssertEqual(InviteLink.topic(from: URL(string: "seekdeep://join/?topic=\(topic)")!), topic)
    }

    func testWrongSchemeIsRejected() {
        XCTAssertNil(InviteLink.topic(from: URL(string: "https://join/\(topic)")!))
        XCTAssertNil(InviteLink.topic(from: URL(string: "http://join/\(topic)")!))
        XCTAssertNil(InviteLink.topic(from: URL(string: "seekdeepx://join/\(topic)")!))
    }

    func testWrongHostIsRejected() {
        XCTAssertNil(InviteLink.topic(from: URL(string: "seekdeep://wrong/\(topic)")!))
        XCTAssertNil(InviteLink.topic(from: URL(string: "seekdeep://join.evil.example/\(topic)")!))
        // No host at all is not the join host.
        XCTAssertNil(InviteLink.topic(from: URL(string: "seekdeep:/join/\(topic)")!))
    }

    func testShortAndLongTopicsAreRejected() {
        XCTAssertNil(InviteLink.url(forTopic: String(topic.dropLast())))
        XCTAssertNil(InviteLink.url(forTopic: topic + "0"))
        XCTAssertNil(InviteLink.topic(from: URL(string: "seekdeep://join/\(String(topic.dropLast()))")!))
        XCTAssertNil(InviteLink.topic(from: URL(string: "seekdeep://join/\(topic)0")!))
        // A prefix of a real topic is not a topic.
        XCTAssertNil(InviteLink.topic(from: URL(string: "seekdeep://join/\(topic.prefix(32))")!))
    }

    func testNonHexTopicIsRejected() {
        let notHex = String(repeating: "g", count: 64)
        XCTAssertNil(InviteLink.url(forTopic: notHex))
        XCTAssertNil(InviteLink.topic(from: URL(string: "seekdeep://join/\(notHex)")!))
    }

    func testExtraPathQueryUserAndPortAreRejected() {
        XCTAssertNil(InviteLink.topic(from: URL(string: "seekdeep://join/\(topic)/extra")!))
        XCTAssertNil(InviteLink.topic(from: URL(string: "seekdeep://join/\(topic)?x=1")!))
        XCTAssertNil(InviteLink.topic(from: URL(string: "seekdeep://join?topic=\(topic)&x=1")!))
        XCTAssertNil(InviteLink.topic(from: URL(string: "seekdeep://join?not=\(topic)")!))
        XCTAssertNil(InviteLink.topic(from: URL(string: "seekdeep://u:p@join/\(topic)")!))
        XCTAssertNil(InviteLink.topic(from: URL(string: "seekdeep://join:8080/\(topic)")!))
        XCTAssertNil(InviteLink.topic(from: URL(string: "seekdeep://join/\(topic)#frag")!))
    }

    func testURLForInvalidTopicIsNil() {
        XCTAssertNil(InviteLink.url(forTopic: ""))
        XCTAssertNil(InviteLink.url(forTopic: "local"))
        XCTAssertNil(InviteLink.url(forTopic: "../escape"))
    }
}
