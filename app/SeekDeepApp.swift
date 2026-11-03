import SeekDeepCore
import SwiftUI

@main
struct SeekDeepApp: App {
    @StateObject private var model: ChatViewModel

    init() {
        let root = (try? WorkletHost.storageRoot()) ?? FileManager.default.temporaryDirectory
        // Encrypt saved transcripts at rest. A Keychain failure is not silent: the
        // store stays plaintext for this launch and the view model banners the reason
        // once the view exists.
        var keys: SessionKeyProviding? = KeychainSessionKey()
        var firstLaunchWarning: String?
        do {
            _ = try keys?.key()
        } catch {
            keys = nil
            firstLaunchWarning = "Saved transcripts will not be encrypted this launch: \(error.localizedDescription)"
        }
        _model = StateObject(wrappedValue: ChatViewModel(
            transport: WorkletHost.makeTransport(storageRoot: root),
            sessionStore: SessionStore(root: root.appending(path: "sessions"), keys: keys),
            firstLaunchWarning: firstLaunchWarning
        ))
    }

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .task { await model.start() }
        }
        .defaultSize(width: 760, height: 560)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandGroup(after: .saveItem) {
                Button("Export Transcript…") { model.exportTranscript() }
                    .keyboardShortcut("e", modifiers: [.command, .shift])
                    .disabled(model.state.messages.isEmpty)
                Button("Export Session as JSON…") { model.exportSessionJSON() }
                    .keyboardShortcut("j", modifiers: [.command, .shift])
                    .disabled(model.state.messages.isEmpty)
                Button("Import Session…") {
                    Task { await model.importSessionJSON() }
                }
                .keyboardShortcut("i", modifiers: [.command, .shift])
                Divider()
                Button("Retry Last Prompt") {
                    Task { await model.retryLastPrompt() }
                }
                .keyboardShortcut("r", modifiers: .command)
                .disabled(!model.canRetry())
            }
        }
    }
}
