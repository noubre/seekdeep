import Foundation

/// Newline-framed JSON-RPC client for the worker pipe.
///
/// Responsibilities, in order: frame the request, correlate the response by id, time it
/// out, and fan unsolicited `{event,data}` frames out on `notifications`. It deliberately
/// knows nothing about chat semantics — that is `ChatReducer`'s job.
public actor RPCClient {
    /// `nonisolated` so views and tests can iterate it without hopping onto the actor;
    /// `AsyncStream` is Sendable and the stream itself is the synchronization.
    public nonisolated let notifications: AsyncStream<RPCNotification>

    private let transport: any WorkletTransport
    private let writer: SerialWriter
    private let timeout: Duration
    private let sink: AsyncStream<RPCNotification>.Continuation

    private var nextID = 0
    private var pending: [String: CheckedContinuation<JSONValue, Error>] = [:]
    private var buffer = Data()
    private var readTask: Task<Void, Never>?

    public init(transport: any WorkletTransport, timeout: Duration = .seconds(60)) {
        self.transport = transport
        self.writer = SerialWriter(transport: transport)
        self.timeout = timeout
        let (stream, continuation) = AsyncStream.makeStream(of: RPCNotification.self)
        self.notifications = stream
        self.sink = continuation
    }

    public func start() async throws {
        guard readTask == nil else { return }
        let inbound = transport.inbound
        readTask = Task { [weak self] in
            for await chunk in inbound {
                await self?.ingest(chunk)
            }
            await self?.closePending(RPCError(message: "worker pipe closed"))
        }
        try await transport.start()
    }

    public func request(_ method: String, _ params: [String: JSONValue] = [:]) async throws -> JSONValue {
        nextID += 1
        let id = String(nextID)
        let frame = try RPCFrame.encodeRequest(id: id, method: method, params: params)

        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            Task { [weak self] in
                guard let self else { return }
                do {
                    try await self.writer.send(frame)
                } catch {
                    await self.fail(id, error)
                }
            }
            Task { [weak self, timeout] in
                try? await Task.sleep(for: timeout)
                await self?.fail(id, RPCError(message: "\(method) timed out"))
            }
        }
    }

    /// Stops reading and fails every in-flight request. The transport owns its own
    /// stream, so it is left to finish it.
    public func stop() async {
        readTask?.cancel()
        readTask = nil
        finish(RPCError(message: "client stopped"))
        await transport.stop()
    }

    private func fail(_ id: String, _ error: Error) {
        guard let pendingContinuation = pending.removeValue(forKey: id) else { return }
        pendingContinuation.resume(throwing: error)
    }

    private func finish(_ error: Error) {
        for continuation in pending.values { continuation.resume(throwing: error) }
        pending.removeAll()
        sink.finish()
    }

    private func closePending(_ error: Error) {
        finish(error)
    }

    private func ingest(_ chunk: Data) {
        buffer.append(chunk)
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = Data(buffer[buffer.startIndex..<newline])
            buffer = Data(buffer[buffer.index(after: newline)...])
            guard !line.isEmpty else { continue }
            guard let frame = try? RPCFrame(line: line) else { continue }
            switch frame {
            case .notification(let notification):
                sink.yield(notification)
            case .response(let id, let result):
                pending.removeValue(forKey: id)?.resume(returning: result)
            case .failure(let id, let error):
                pending.removeValue(forKey: id)?.resume(throwing: error)
            }
        }
    }
}
