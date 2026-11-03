import XCTest
@testable import SeekDeepCore

final class SessionCryptoTests: XCTestCase {
    private let key = Data(repeating: 0x2a, count: 32)

    /// A payload in the same shape and rough size as a saved transcript.
    private func storedSessionPayload() throws -> Data {
        let messages = (0..<200).map { index in
            StoredMessage(ChatMessage(
                id: "m\(index)",
                kind: index.isMultiple(of: 2) ? .user : .assistant,
                content: "message \(index) " + String(repeating: "payload ", count: 16)
            ))
        }
        let session = StoredSession(
            id: "s1",
            name: "Round trip",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            messages: messages
        )
        return try JSONEncoder().encode(session)
    }

    func testRoundTripOfAStoredSessionSizedPayload() throws {
        let plaintext = try storedSessionPayload()
        let sealed = try SessionCrypto.seal(plaintext, using: key)
        XCTAssertNotEqual(sealed, plaintext)
        XCTAssertEqual(try SessionCrypto.open(sealed, using: key), plaintext)
    }

    func testWrongKeyThrowsInsteadOfReturningGarbage() throws {
        let sealed = try SessionCrypto.seal(Data("secret transcript".utf8), using: key)
        let other = Data(repeating: 0x2b, count: 32)
        XCTAssertThrowsError(try SessionCrypto.open(sealed, using: other))
    }

    func testFlippedCiphertextByteThrows() throws {
        let sealed = try SessionCrypto.seal(Data("secret transcript".utf8), using: key)
        var envelope = try JSONDecoder().decode(SessionCrypto.Envelope.self, from: sealed)
        var ciphertext = try XCTUnwrap(Data(base64Encoded: envelope.ct))
        ciphertext[ciphertext.count - 1] ^= 0x01
        envelope.ct = ciphertext.base64EncodedString()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let tampered = try encoder.encode(envelope)
        XCTAssertThrowsError(try SessionCrypto.open(tampered, using: key))
    }

    func testTruncatedEnvelopeThrows() throws {
        let sealed = try SessionCrypto.seal(Data("secret transcript".utf8), using: key)
        XCTAssertThrowsError(try SessionCrypto.open(sealed.prefix(sealed.count / 2), using: key))
        XCTAssertThrowsError(try SessionCrypto.open(Data(), using: key))
    }

    func testIsSealedIsTrueForSealedOutputAndFalseForPlainJSON() throws {
        let sealed = try SessionCrypto.seal(Data("secret transcript".utf8), using: key)
        XCTAssertTrue(SessionCrypto.isSealed(sealed))

        let plainJSON = try JSONEncoder().encode(["hello": "world"])
        XCTAssertFalse(SessionCrypto.isSealed(plainJSON))
        XCTAssertFalse(SessionCrypto.isSealed(Data("not json".utf8)))
        XCTAssertFalse(SessionCrypto.isSealed(Data()))
    }

    func testKeyThatIsNot32BytesThrows() throws {
        for length in [0, 16, 31, 33, 64] {
            XCTAssertThrowsError(try SessionCrypto.seal(Data("secret".utf8), using: Data(repeating: 0, count: length))) {
                XCTAssertEqual($0 as? SessionCryptoError, .invalidKeyLength(length))
            }
            XCTAssertThrowsError(try InMemorySessionKey(bytes: Data(repeating: 0, count: length)).key())
        }
    }

    func testSealedOutputIsTheDocumentedEnvelope() throws {
        let sealed = try SessionCrypto.seal(Data("secret transcript".utf8), using: key)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: sealed) as? [String: Any])
        XCTAssertEqual(json["v"] as? Int, 1)
        XCTAssertEqual(json["alg"] as? String, "A256GCM")
        XCTAssertNotNil(json["nonce"] as? String)
        XCTAssertNotNil(json["ct"] as? String)
        XCTAssertNotNil(json["tag"] as? String)
        // 12-byte nonce, 16-byte tag.
        XCTAssertEqual(Data(base64Encoded: try XCTUnwrap(json["nonce"] as? String))?.count, 12)
        XCTAssertEqual(Data(base64Encoded: try XCTUnwrap(json["tag"] as? String))?.count, 16)
    }

    func testEachSealUsesAFreshNonce() throws {
        let plaintext = Data("secret transcript".utf8)
        let first = try SessionCrypto.seal(plaintext, using: key)
        let second = try SessionCrypto.seal(plaintext, using: key)
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(try SessionCrypto.open(first, using: key), plaintext)
        XCTAssertEqual(try SessionCrypto.open(second, using: key), plaintext)
    }

    func testInMemoryKeyRejectsTheWrongLength() throws {
        XCTAssertThrowsError(try InMemorySessionKey(bytes: Data(repeating: 0, count: 31)).key())
        XCTAssertEqual(try InMemorySessionKey(bytes: key).key(), key)
    }
}
