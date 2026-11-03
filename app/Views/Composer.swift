import SeekDeepCore
import SwiftUI

struct Composer: View {
    @ObservedObject var model: ChatViewModel
    @FocusState private var focused: Bool

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
    }
}
