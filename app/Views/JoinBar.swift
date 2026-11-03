import SeekDeepCore
import SwiftUI

struct JoinBar: View {
    @ObservedObject var model: ChatViewModel
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                TextField("Join a room — paste a 64-character topic key", text: $model.joinTopic)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12, design: .monospaced))
                    .padding(6)
                    .background(Theme.canvas)
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                Button("Join") {
                    Task { await model.join() }
                }
                .disabled(model.joinTopic.trimmingCharacters(in: .whitespaces).isEmpty)

                if model.state.role != "none" {
                    Button("Leave") {
                        Task { await model.leave() }
                    }
                }
            }
            if let topic = model.state.topic {
                HStack(spacing: 6) {
                    Text(topic)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(Theme.secondaryText.opacity(0.5))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(topic, forType: .string)
                    } label: {
                        Image(systemName: "doc.on.doc")
                    }
                    .buttonStyle(.borderless)
                    .help("Copy the topic key")
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.chrome.opacity(0.85))
    }
}
