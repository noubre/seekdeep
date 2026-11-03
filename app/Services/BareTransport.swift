import BareKit
import Foundation
import SeekDeepCore

/// Ships: the worklet runs on its own thread inside this process (BareKit).
final class BareTransport: WorkletTransport, @unchecked Sendable {
    private var worklet: Worklet?
    private var ipc: IPC?
    private let storageRoot: URL
    private let additionalArguments: [String]
    private let continuation: AsyncStream<Data>.Continuation
    let inbound: AsyncStream<Data>

    init(storageRoot: URL, additionalArguments: [String] = []) {
        self.storageRoot = storageRoot
        self.additionalArguments = additionalArguments
        var captured: AsyncStream<Data>.Continuation!
        inbound = AsyncStream { captured = $0 }
        continuation = captured
    }

    func start() async throws {
        let worklet = try Worklet()
        let ipc = try IPC(worklet: worklet)
        self.worklet = worklet
        self.ipc = ipc

        Task { [ipc, continuation] in
            do {
                for try await chunk in ipc { continuation.yield(chunk) }
            } catch {
                continuation.finish()
            }
        }

        // The storage root travels as a worklet argument: a Bare worklet has no Pear config,
        // so the worker's storage resolver needs it passed in. A relative filename resolves
        // against the app bundle's resources.
        try worklet.start("app.bundle", arguments: ["--storage=\(storageRoot.path)"] + additionalArguments)
    }

    func send(_ data: Data) async throws {
        guard let ipc else { throw BareKitError.closed }
        try await ipc.write(data)
    }

    /// Order matters: end, close, terminate, wait, then let the process go. `end()` alone
    /// leaves the worklet alive (BareKit keeps it running until both IPC sides have ended)
    /// and exiting with a live worklet aborts the process, intermittently.
    func stop() async {
        continuation.finish()
        ipc?.end()
        ipc?.close()
        ipc = nil
        worklet?.terminate()
        _ = await worklet?.wait()
        worklet = nil
    }
}
