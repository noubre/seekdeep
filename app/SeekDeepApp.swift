import SwiftUI

@main
struct SeekDeepApp: App {
    @StateObject private var model: ChatViewModel

    init() {
        let root = (try? WorkletHost.storageRoot()) ?? FileManager.default.temporaryDirectory
        _model = StateObject(wrappedValue: ChatViewModel(transport: WorkletHost.makeTransport(storageRoot: root)))
    }

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .task { await model.start() }
        }
        .defaultSize(width: 760, height: 560)
        .commands { CommandGroup(replacing: .newItem) {} }
    }
}
