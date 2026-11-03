import Foundation

public struct RPCError: Error, Equatable, Sendable {
    public let message: String
    public let code: String?

    public init(message: String, code: String? = nil) {
        self.message = message
        self.code = code
    }
}

extension RPCError: LocalizedError {
    public var errorDescription: String? { message }
}

public enum RPCFrameError: Error, Equatable {
    case malformed(String)
}

/// One line of the worker pipe.
///
/// Mirrors `js/p2p/rpc-server.js`: responses are exactly `{id,ok,result}` or
/// `{id,ok,error}`, events are exactly `{event,data}`. Anything else is dropped rather
/// than guessed at, because a lenient decoder would turn a protocol bug into a silent
/// missing message.
public enum RPCFrame: Equatable, Sendable {
    case response(id: String, result: JSONValue)
    case failure(id: String, error: RPCError)
    case notification(RPCNotification)

    public init(line: Data) throws {
        let decoded: JSONValue
        do {
            decoded = try JSONDecoder().decode(JSONValue.self, from: line)
        } catch {
            throw RPCFrameError.malformed("not JSON")
        }
        guard let object = decoded.object else { throw RPCFrameError.malformed("not a JSON object") }
        let keys = Set(object.keys)

        if keys == ["event", "data"] {
            guard let name = object["event"]?.string, Self.isValidEventName(name) else {
                throw RPCFrameError.malformed("invalid event name")
            }
            self = .notification(RPCNotification(name: name, data: object["data"] ?? .null))
            return
        }

        if keys == ["id", "ok", "result"], object["ok"]?.bool == true {
            guard let id = Self.identifier(object["id"]) else { throw RPCFrameError.malformed("invalid id") }
            self = .response(id: id, result: object["result"] ?? .null)
            return
        }

        if keys == ["id", "ok", "error"], object["ok"]?.bool == false {
            guard let id = Self.identifier(object["id"]) else { throw RPCFrameError.malformed("invalid id") }
            switch object["error"] {
            case .string(let message)?:
                self = .failure(id: id, error: RPCError(message: message))
            case .object(let payload)? where Set(payload.keys) == ["code", "message"]:
                guard let code = payload["code"]?.string, let message = payload["message"]?.string else {
                    throw RPCFrameError.malformed("invalid error payload")
                }
                self = .failure(id: id, error: RPCError(message: message, code: code))
            default:
                throw RPCFrameError.malformed("invalid error payload")
            }
            return
        }

        throw RPCFrameError.malformed("unknown frame shape")
    }

    /// Serializes one request with the trailing newline the worker expects. The server
    /// rejects extra keys, so the object is built explicitly rather than encoded from a
    /// dictionary that might have grown.
    public static func encodeRequest(id: String, method: String, params: [String: JSONValue]) throws -> Data {
        guard !id.isEmpty, id.utf8.count <= 64 else { throw RPCFrameError.malformed("bad id") }
        guard !method.isEmpty else { throw RPCFrameError.malformed("bad method") }
        let payload = JSONValue.object(["id": .string(id), "method": .string(method), "params": .object(params)])
        // Sorted keys make the wire bytes deterministic, which is worth far more than the
        // microseconds it costs: a captured frame can be compared byte for byte.
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var data = try encoder.encode(payload)
        data.append(0x0A)
        return data
    }

    /// Request ids are echoed verbatim; the client only sends strings, but the server also
    /// accepts safe integers (`validateRequest`), so both are honoured.
    private static func identifier(_ value: JSONValue?) -> String? {
        guard let value else { return nil }
        switch value {
        case .string(let text):
            guard !text.isEmpty, text.utf8.count <= 64 else { return nil }
            return text
        case .number(let number):
            guard number >= 0, number.rounded() == number, number.magnitude < 9e15 else { return nil }
            return String(Int(number))
        default:
            return nil
        }
    }

    /// Mirrors `EVENT_PATTERN`: `/^[a-z][a-z0-9.-]{0,63}$/`.
    private static func isValidEventName(_ name: String) -> Bool {
        guard let first = name.first, first.isLowercase, first.isASCII, name.count <= 64 else { return false }
        return name.allSatisfy { character in
            character.isASCII && (character.isLowercase || character.isNumber || character == "." || character == "-")
        }
    }
}
