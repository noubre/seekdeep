import Foundation

/// The byte pipe to the worker.
///
/// Implemented by `BareTransport` (BareKit IPC) in the app, and by `ProcessTransport`
/// (a `node worklet/dev.js` child) in development and integration tests. The core never
/// imports BareKit, which is what keeps `swift test` free of Xcode and V8.
public protocol WorkletTransport: AnyObject, Sendable {
    func start() async throws
    func send(_ data: Data) async throws
    var inbound: AsyncStream<Data> { get }
    func stop() async
}
