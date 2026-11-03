import Foundation

/// Development transport: spawns `node worklet/dev.js --stdio` and speaks the same
/// newline-JSON protocol as the BareKit transport.
///
/// It lives in the core (not in the app) because it is what makes the whole Swift stack
/// testable without Xcode, V8 or a packed bundle: `swift test` can boot the real worker,
/// create a room and round-trip a request. The app uses it only in DEBUG, behind
/// `SEEKDEEP_DEV_TRANSPORT=process`.
public final class ProcessTransport: WorkletTransport, @unchecked Sendable {
    private let process = Process()
    private let stdinPipe = Pipe()
    private let stdoutPipe = Pipe()
    private let writeLock = NSLock()
    private let continuation: AsyncStream<Data>.Continuation
    public let inbound: AsyncStream<Data>

    public init(repositoryRoot: URL, storageRoot: URL, additionalArguments: [String] = []) {
        var captured: AsyncStream<Data>.Continuation!
        inbound = AsyncStream { captured = $0 }
        continuation = captured

        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", "worklet/dev.js", "--stdio", "--storage=\(storageRoot.path)"]
            + additionalArguments
        process.currentDirectoryURL = repositoryRoot
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = FileHandle.standardError

        stdoutPipe.fileHandleForReading.readabilityHandler = { [continuation] handle in
            let data = handle.availableData
            if data.isEmpty {
                continuation.finish()
            } else {
                continuation.yield(data)
            }
        }
    }

    /// Walks up from `start` looking for the checkout that contains the JS core.
    ///
    /// Deriving the root from `#filePath` was the first attempt and it broke in the app:
    /// Xcode compiles the package with *relative* source paths, so `URL(fileURLWithPath:)`
    /// resolved against `/`. Searching for `worklet/dev.js` is stable in both worlds.
    public static func findRepositoryRoot(startingAt start: URL) -> URL? {
        var url = start.hasDirectoryPath ? start : start.deletingLastPathComponent()
        for _ in 0..<10 {
            let candidate = url.appending(path: "worklet/dev.js")
            if FileManager.default.fileExists(atPath: candidate.path) { return url }
            let parent = url.deletingLastPathComponent()
            if parent.path == url.path { break }
            url = parent
        }
        return nil
    }

    public func start() async throws {
        FileHandle.standardError.write(Data("[seekdeep] note: spawning \(process.arguments?.joined(separator: " ") ?? "")\n".utf8))
        try process.run()
    }

    public func send(_ data: Data) async throws {
        writeLock.lock()
        defer { writeLock.unlock() }
        try stdinPipe.fileHandleForWriting.write(contentsOf: data)
    }

    public func stop() async {
        stdoutPipe.fileHandleForReading.readabilityHandler = nil
        if process.isRunning {
            process.terminate()
            process.waitUntilExit()
        }
        continuation.finish()
    }
}
