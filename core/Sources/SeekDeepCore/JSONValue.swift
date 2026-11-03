import Foundation

/// A JSON document with no schema. The worker's payloads are dynamic — `chat.event`
/// alone has six shapes — so the boundary decodes to this and the typed layer is built
/// on top, exactly as `js/p2p/rpc-codec.js` works with plain objects.
public enum JSONValue: Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])
}

extension JSONValue: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "unsupported JSON value")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

public extension JSONValue {
    subscript(key: String) -> JSONValue? {
        guard case .object(let object) = self else { return nil }
        return object[key]
    }

    var string: String? { if case .string(let value) = self { return value } else { return nil } }
    var bool: Bool? { if case .bool(let value) = self { return value } else { return nil } }
    var double: Double? { if case .number(let value) = self { return value } else { return nil } }
    var array: [JSONValue]? { if case .array(let value) = self { return value } else { return nil } }
    var object: [String: JSONValue]? { if case .object(let value) = self { return value } else { return nil } }

    /// Numbers always decode as `Double`; ids, counts and millisecond timestamps arrive
    /// as whole non-negative values, so narrow explicitly and reject anything else.
    var int: Int? {
        guard case .number(let value) = self, value >= 0, value.rounded() == value, value.magnitude < 9e15 else { return nil }
        return Int(value)
    }

    static func str(_ value: String) -> JSONValue { .string(value) }
    static func intValue(_ value: Int) -> JSONValue { .number(Double(value)) }
}
