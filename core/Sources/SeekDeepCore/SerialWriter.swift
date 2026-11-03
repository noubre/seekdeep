import Foundation

/// Serializes writes so two concurrent `request()` calls can never interleave halves of
/// two frames on the wire. The worker parses lines, so a torn write is a protocol error,
/// not a small glitch.
public actor SerialWriter {
    private let transport: any WorkletTransport
    private var tail: Task<Void, Error>?

    public init(transport: any WorkletTransport) {
        self.transport = transport
    }

    public func send(_ data: Data) async throws {
        let previous = tail
        let task = Task { [transport] in
            _ = try? await previous?.value
            try await transport.send(data)
        }
        tail = task
        try await task.value
    }
}
