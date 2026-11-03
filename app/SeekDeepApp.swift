import BareKit
import Foundation
import SwiftUI

/// Boot probe: proves the packed worklet loads, answers a real RPC request, and that
/// `Bare.IPC` round-trips through BareKit. Replaced by the real transports in Phase 3.
final class WorkletProbe: @unchecked Sendable {
    private var worklet: Worklet?
    private var ipc: IPC?

    func start() {
        let storage = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "SeekDeep", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: storage, withIntermediateDirectories: true)

        do {
            let worklet = try Worklet()
            let ipc = try IPC(worklet: worklet)
            self.worklet = worklet
            self.ipc = ipc

            try worklet.start("app.bundle", arguments: ["--storage=\(storage.path)"])
            log("[probe] worklet started, storage=\(storage.path)")

            Task { [weak self] in
                guard let self else { return }
                guard let ipc = self.ipc else { return }
                let request = #"{"id":"1","method":"chat.status","params":{}}"# + "\n"
                try? await ipc.write(Data(request.utf8))

                let deadline = Date().addingTimeInterval(20)
                do {
                    for try await chunk in ipc {
                        let text = String(decoding: chunk, as: UTF8.self)
                        log("[probe] <- \(text.trimmingCharacters(in: .newlines))")
                        if text.contains(#""id":"1""#) {
                            log("[probe] OK: chat.status answered over Bare.IPC")
                            // Order matters: end the pipe, release the worklet, then
                            // exit. Exiting with a live worklet aborts the process.
                            self.ipc?.end()
                            self.ipc = nil
                            self.worklet = nil
                            exit(0)
                        }
                        if Date() > deadline { break }
                    }
                } catch {
                    log("[probe] ipc error: \(error)")
                }
                log("[probe] FAIL: no chat.status reply within 20s")
                exit(2)
            }
        } catch {
            log("[probe] FAIL: \(error)")
            exit(1)
        }
    }

    private func log(_ message: String) {
        FileHandle.standardError.write(Data((message + "\n").utf8))
    }
}

@main
struct SeekDeepApp: App {
    private let probe = WorkletProbe()

    var body: some Scene {
        WindowGroup {
            Text("SeekDeep boot probe — see stdout")
                .padding(40)
                .task { probe.start() }
        }
    }
}
