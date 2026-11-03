import Foundation
import SeekDeepCore

enum WorkletHost {
    /// One directory for every backend store: the worker's Hypercore storage, its
    /// downloads and the session files all live under it.
    static func storageRoot() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let root = base.appending(path: "SeekDeep", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    /// Extra worker flags, space separated. The dev loop uses this to point the worker at a
    /// fake or non-default model server (`--ollama-url=http://127.0.0.1:11999`), and the
    /// interop check uses it to join a loopback DHT (`--local-dht=40001`).
    static var extraArguments: [String] {
        (ProcessInfo.processInfo.environment["SEEKDEEP_WORKLET_ARGS"] ?? "")
            .split(separator: " ")
            .map(String.init)
    }

    static func makeTransport(storageRoot: URL) -> any WorkletTransport {
        let extra = extraArguments
        #if DEBUG
        if ProcessInfo.processInfo.environment["SEEKDEEP_DEV_TRANSPORT"] == "process" {
            AppLog.note("transport: node process (dev), args=\(extra)")
            guard let root = ProcessTransport.findRepositoryRoot(startingAt: Bundle.main.bundleURL) else {
                AppLog.fail("dev transport requested but worklet/dev.js was not found above \(Bundle.main.bundleURL.path)")
                return BareTransport(storageRoot: storageRoot, additionalArguments: extra)
            }
            return ProcessTransport(repositoryRoot: root, storageRoot: storageRoot, additionalArguments: extra)
        }
        #endif
        AppLog.note("transport: embedded worklet, args=\(extra)")
        return BareTransport(storageRoot: storageRoot, additionalArguments: extra)
    }
}
