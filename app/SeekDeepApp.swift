import SeekDeepCore
import SwiftUI

@main
struct SeekDeepApp: App {
    @StateObject private var model: ChatViewModel

    init() {
        let root = (try? WorkletHost.storageRoot()) ?? FileManager.default.temporaryDirectory
        _model = StateObject(wrappedValue: ChatViewModel(
            transport: WorkletHost.makeTransport(storageRoot: root),
            sessionStore: SessionStore(root: root.appending(path: "sessions"))
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
            }
        }
    }
}
