import CryptoKit
import Foundation
import Security

/// A source for the 32-byte AES-256 key that seals saved transcripts.
///
/// Conforming types must never log key material.
public protocol SessionKeyProviding: Sendable {
    /// The AES-256 key. Must be exactly 32 bytes.
    func key() throws -> Data
}

/// A fixed in-memory key. For tests and previews; never persisted.
public struct InMemorySessionKey: SessionKeyProviding {
    private let bytes: Data

    public init(bytes: Data) {
        self.bytes = bytes
    }

    public func key() throws -> Data {
        try SessionCrypto.validatedKey(bytes)
    }
}

/// Production key: 32 random bytes stored as a Keychain generic password
/// (`service "to.seekdeep.native"`, `account "sessions-key"`). The item is created
/// on first use and reused afterwards. A locked keychain or a stored key of the
/// wrong length throws; it is never silently replaced.
public struct KeychainSessionKey: SessionKeyProviding {
    private static let service = "to.seekdeep.native"
    private static let account = "sessions-key"

    public init() {}

    public func key() throws -> Data {
        if let existing = try Self.existing() { return existing }
        let fresh = Data(SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) })
        do {
            try Self.store(fresh)
            return fresh
        } catch let SessionCryptoError.keychainStatus(status) {
            // Lost a creation race: another caller stored the key first, and that
            // stored key is the one every launch must agree on.
            guard status == errSecDuplicateItem, let existing = try Self.existing() else {
                throw SessionCryptoError.keychainStatus(status)
            }
            return existing
        }
    }

    /// `nil` only when the item is absent. Every other Keychain status throws.
    private static func existing() throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw SessionCryptoError.keychainStatus(status) }
        guard let data = item as? Data else { throw SessionCryptoError.keychainStatus(errSecItemNotFound) }
        guard data.count == 32 else { throw SessionCryptoError.wrongStoredKeyLength(data.count) }
        return data
    }

    private static func store(_ key: Data) throws {
        let attributes: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: key,
            // Available after first unlock so a launch at login time still works.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else { throw SessionCryptoError.keychainStatus(status) }
    }
}

public enum SessionCryptoError: Error, Sendable, LocalizedError, Equatable {
    case invalidKeyLength(Int)
    case wrongStoredKeyLength(Int)
    case notAnEnvelope
    case unsupportedVersion(Int)
    case unsupportedAlgorithm(String)
    case corruptedEnvelope
    case authenticationFailure
    case keychainStatus(OSStatus)

    public var errorDescription: String? {
        switch self {
        case .invalidKeyLength(let count):
            return "session key must be 32 bytes, got \(count)"
        case .wrongStoredKeyLength(let count):
            return "stored session key must be 32 bytes, got \(count)"
        case .notAnEnvelope:
            return "data is not a sealed session envelope"
        case .unsupportedVersion(let version):
            return "sealed session version \(version) is not supported"
        case .unsupportedAlgorithm(let algorithm):
            return "sealed session algorithm \(algorithm) is not supported"
        case .corruptedEnvelope:
            return "sealed session envelope is incomplete or malformed"
        case .authenticationFailure:
            return "sealed session failed authentication (wrong key or tampered data)"
        case .keychainStatus(let status):
            return "Keychain error \(status)"
        }
    }
}

/// AES-256-GCM sealing of session bodies.
///
/// The wire format is a JSON envelope with sorted keys:
/// `{"alg":"A256GCM","ct":"<b64>","nonce":"<b64>","tag":"<b64>","v":1}`.
/// `open` throws on a wrong key or tampered ciphertext (GCM authentication
/// failure); it never returns garbage. Key material is never logged.
public enum SessionCrypto {
    struct Envelope: Codable, Equatable, Sendable {
        var v: Int
        var alg: String
        var nonce: String
        var ct: String
        var tag: String
    }

    public static func seal(_ plaintext: Data, using key: Data) throws -> Data {
        let key = try validatedKey(key)
        let box = try AES.GCM.seal(plaintext, using: SymmetricKey(data: key))
        // `combined` is nonce(12) || ciphertext || tag(16). AES.GCM.Nonce does not
        // expose its bytes, so the nonce comes back out of the combined encoding.
        guard let combined = box.combined, combined.count >= 12 + 16 else {
            throw SessionCryptoError.corruptedEnvelope
        }
        let envelope = Envelope(
            v: 1,
            alg: "A256GCM",
            nonce: combined.prefix(12).base64EncodedString(),
            ct: combined.dropFirst(12).dropLast(16).base64EncodedString(),
            tag: combined.suffix(16).base64EncodedString()
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(envelope)
    }

    public static func open(_ sealed: Data, using key: Data) throws -> Data {
        let key = try validatedKey(key)
        let envelope: Envelope
        do {
            envelope = try JSONDecoder().decode(Envelope.self, from: sealed)
        } catch {
            throw SessionCryptoError.notAnEnvelope
        }
        guard envelope.v == 1 else { throw SessionCryptoError.unsupportedVersion(envelope.v) }
        guard envelope.alg == "A256GCM" else { throw SessionCryptoError.unsupportedAlgorithm(envelope.alg) }
        guard let nonce = Data(base64Encoded: envelope.nonce),
              let ciphertext = Data(base64Encoded: envelope.ct),
              let tag = Data(base64Encoded: envelope.tag)
        else { throw SessionCryptoError.corruptedEnvelope }
        do {
            let box = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: nonce),
                ciphertext: ciphertext,
                tag: tag
            )
            return try AES.GCM.open(box, using: SymmetricKey(data: key))
        } catch {
            throw SessionCryptoError.authenticationFailure
        }
    }

    /// True only when `data` is the documented envelope with `v == 1` and
    /// `alg == "A256GCM"`. Does not authenticate the ciphertext.
    public static func isSealed(_ data: Data) -> Bool {
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data) else { return false }
        return envelope.v == 1 && envelope.alg == "A256GCM"
    }

    static func validatedKey(_ key: Data) throws -> Data {
        guard key.count == 32 else { throw SessionCryptoError.invalidKeyLength(key.count) }
        return key
    }
}
