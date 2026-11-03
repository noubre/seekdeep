import AppKit
import SeekDeepCore
import SwiftUI

struct Composer: View {
    @ObservedObject var model: ChatViewModel
    @FocusState private var focused: Bool
    /// Local keyDown monitor, installed only while the editor has focus.
    @State private var keyMonitor: Any?

    private var suggestions: [String] {
        guard let query = SlashQuery.command(in: model.draft, caret: model.draft.count) else { return [] }
        return SlashQuery.matches(model.slashCommands, query: query)
    }

    private var hint: String {
        switch model.state.emptyReason {
        case .noProvider: return "No local model server found — start Ollama or LM Studio."
        case .noModel: return "No model selected."
        case .noHost: return "Not connected to a host."
        case nil: return model.state.isHost ? "⌘↩ to send · / for commands" : "⌘↩ to send · connected as a peer"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(hint)
                .font(.system(size: 11))
                .foregroundStyle(Theme.secondaryText.opacity(0.6))

            if !suggestions.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(suggestions.prefix(8), id: \.self) { command in
                            Text("/" + command)
                                .font(.system(size: 12, design: .monospaced))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Theme.ephemeral)
                                .clipShape(Capsule())
                                .onTapGesture {
                                    model.draft = "/" + command + " "
                                    focused = true
                                }
                        }
                    }
                }
            }

            HStack(alignment: .bottom, spacing: 8) {
                if model.canRetry() {
                    Button {
                        Task { await model.retryLastPrompt() }
                    } label: {
                        HStack(spacing: 3) {
                            Image(systemName: "arrow.clockwise")
                            Text("Retry")
                        }
                        .font(.system(size: 11, weight: .medium))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.secondaryText)
                    .help("Send the last prompt again (⌘R)")
                }

                TextEditor(text: $model.draft)
                    .font(.system(size: 13))
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 34, maxHeight: 120)
                    .padding(6)
                    .background(Theme.canvas)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .focused($focused)

                if model.canCancel {
                    Button {
                        Task { await model.cancel() }
                    } label: {
                        Image(systemName: "stop.circle.fill")
                            .font(.system(size: 22))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.warning)
                    .keyboardShortcut(".", modifiers: .command)
                    .help("Stop generating (⌘.)")
                } else {
                    Button {
                        Task { await model.send() }
                    } label: {
                        Image(systemName: model.isBusy ? "hourglass" : "arrow.up.circle.fill")
                            .font(.system(size: 22))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(model.canSend ? Theme.accent : Theme.systemBubble)
                    .disabled(!model.canSend)
                    .keyboardShortcut(.return, modifiers: .command)
                }
            }
        }
        .padding(12)
        .background(Color.black.opacity(0.15))
        .onChange(of: focused) { _, isFocused in
            if isFocused {
                installRecallMonitor()
            } else {
                removeRecallMonitor()
            }
        }
        .onDisappear(perform: removeRecallMonitor)
    }

    /// `.onKeyPress` does not see key events while a `TextEditor` is first responder on
    /// macOS 14, so recall is a local `NSEvent` monitor that exists only while the
    /// composer is focused. Up arrow is taken when the draft is empty (nothing for the
    /// caret to run into) or while a recall browse is already active; down arrow is
    /// taken only while browsing, so it never steals end-of-text motion in a draft.
    private func installRecallMonitor() {
        guard keyMonitor == nil else { return }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            let modifiers = event.modifierFlags.intersection([.command, .option, .control, .shift])
            guard modifiers.isEmpty else { return event }
            switch event.keyCode {
            case 126: // up arrow
                guard model.draft.isEmpty || model.recall.index != nil else { return event }
                model.recallOlder()
                return nil
            case 125: // down arrow
                guard model.recall.index != nil else { return event }
                model.recallNewer()
                return nil
            default:
                return event
            }
        }
    }

    private func removeRecallMonitor() {
        guard let monitor = keyMonitor else { return }
        NSEvent.removeMonitor(monitor)
        keyMonitor = nil
    }
}
