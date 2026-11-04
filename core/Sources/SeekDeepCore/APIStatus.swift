import Foundation

/// The worker's OpenAI-surface state. `running == false` is the off state; the
/// remaining fields only describe a server that is actually listening.
///
/// There is one mode: every request is forwarded over the room to its host, which answers
/// from its own providers — locally when this node is the host. So a running endpoint is
/// always "the room host's models".
public struct APIStatus: Equatable, Sendable {
    public var running: Bool
    public var url: String?
    public var port: Int?
    public var auth: Bool

    public static let off = APIStatus(running: false, url: nil, port: nil, auth: false)

    public init(running: Bool, url: String? = nil, port: Int? = nil, auth: Bool = false) {
        self.running = running
        self.url = url
        self.port = port
        self.auth = auth
    }

    /// Decodes an `api.status` / `api.start` reply. Anything without a `running` boolean
    /// is not a status payload and is rejected rather than guessed at.
    public init?(json: JSONValue) {
        guard let running = json["running"]?.bool else { return nil }
        self.init(
            running: running,
            url: json["url"]?.string,
            port: json["port"]?.double.map(Int.init),
            auth: json["auth"]?.bool ?? false
        )
    }
}
