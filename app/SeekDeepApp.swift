import BareKit
import Foundation
import SwiftUI

/// Boot probe: proves the packed worklet loads, answers a real RPC request, and that
/// `Bare.IPC` round-trips through BareKit. Phase 3 replaces this with the real transports.
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
                guard let self, let ipc = self.ipc else { return }
                let request = #"{"id":"1","method":"chat.status","params":{}}"# + "\n"
                try? await ipc.write(Data(request.utf8))

                let deadline = Date().addingTimeInterval(20)
                do {
                    for try await chunk in ipc {
                        let text = String(decoding: chunk, as: UTF8.self)
                        log("[probe] <- \(text.trimmingCharacters(in: .newlines))")
                        if text.contains(#""id":"1""#) {
                            log("[probe] OK: chat.status answered over Bare.IPC")
                            await self.shutdown(code: 0)
                            return
                        }
                        if Date() > deadline { break }
                    }
                } catch {
                    log("[probe] ipc error: \(error)")
                }
                log("[probe] FAIL: no chat.status reply within 20s")
                await self.shutdown(code: 2)
            }
        } catch {
            log("[probe] FAIL: \(error)")
            exit(1)
        }
    }

    /// Order matters: end the pipe, close the IPC, terminate if the worklet is still
    /// running, and only then exit. Exiting while the worklet thread still runs aborts
    /// the process.
    private func shutdown(code: Int32) async {
        ipc?.end()
        ipc?.close()
        ipc = nil
        worklet?.terminate()
        _ = await worklet?.wait()
        worklet = nil
        exit(code)
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
            Text("SeekDeep boot probe — see stderr")
                .padding(40)
                .task { probe.start() }
        }
    }
}
