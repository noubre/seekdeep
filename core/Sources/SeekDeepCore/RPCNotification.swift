import Foundation

/// An unsolicited frame from the worker: `{"event":String,"data":JSON}`.
public struct RPCNotification: Equatable, Sendable {
    public let name: String
    public let data: JSONValue

    public init(name: String, data: JSONValue) {
        self.name = name
        self.data = data
    }
}
