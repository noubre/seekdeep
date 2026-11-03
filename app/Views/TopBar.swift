import SeekDeepCore
import SwiftUI

struct TopBar: View {
    @ObservedObject var model: ChatViewModel

    private var topicLabel: String {
        guard let topic = model.state.topic else { return "no room" }
        return String(topic.prefix(10)) + "…" + String(topic.suffix(4))
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "antenna.radiowaves.left.and.right")
                .foregroundStyle(Theme.accent)

            VStack(alignment: .leading, spacing: 1) {
                Text("SeekDeep")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.secondaryText)
                Text(roomSummary)
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.secondaryText.opacity(0.65))
            }

            Spacer()

            if model.state.collaborative {
                Label("collaborative", systemImage: "person.2.fill")
                    .font(.system(size: 10))
                    .foregroundStyle(Theme.warning)
            }

            Button {
                Task { await model.setMode(collaborative: !model.state.collaborative) }
            } label: {
                Image(systemName: model.state.collaborative ? "lock.open" : "lock")
            }
            .buttonStyle(.borderless)
            .help(model.state.collaborative ? "Switch to private mode" : "Share prompts with peers")
            .disabled(!model.state.isHost)

            Button {
                Task { await model.refreshModels() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.borderless)
            .help("Refresh models")
            .disabled(!model.state.isHost)

            historyMenu
            modelMenu
            APIMenu(model: model)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.chrome)
    }

    private var roomSummary: String {
        let role = model.state.role == "none" ? "idle" : model.state.role
        let peers = model.state.peerCount
        return "\(topicLabel) · \(role) · \(peers) peer\(peers == 1 ? "" : "s")"
    }

    /// Replay of past transcripts, keyed by room. Host-side "clear" lives here too so the
    /// destructive action sits next to the thing it clears.
    private var historyMenu: some View {
        Menu {
            if model.sessions.isEmpty {
                Text("no saved sessions")
            } else {
                ForEach(model.sessions) { entry in
                    Button {
                        Task { await model.openSession(entry) }
                    } label: {
                        Text("\(entry.name.isEmpty ? entry.id.prefix(8) : entry.name.prefix(40)) · \(entry.messageCount)")
                    }
                }
                Divider()
                ForEach(model.sessions) { entry in
                    Button("Delete \(String(entry.id.prefix(8)))") {
                        Task { await model.deleteSession(entry) }
                    }
                }
            }
            Divider()
            Button("Clear this conversation") { model.clearConversation() }
                .disabled(model.state.messages.isEmpty)
        } label: {
            Label("History", systemImage: "clock.arrow.circlepath")
                .font(.system(size: 11))
        }
        .menuStyle(.borderlessButton)
    }

    private var modelMenu: some View {
        Menu {
            if let provider = model.state.provider {
                Section("Provider") {
                    ForEach(["ollama", "lmstudio"], id: \.self) { candidate in
                        Button {
                            Task { await model.setProvider(candidate) }
                        } label: {
                            Text(candidate == provider ? "✓ \(candidate)" : candidate)
                        }
                    }
                }
            }
            Section("Model") {
                if model.state.models.isEmpty {
                    Text("none found")
                } else {
                    ForEach(model.state.models) { entry in
                        Button {
                            model.selectModel(entry.id)
                        } label: {
                            Text(entry.id == model.state.selectedModel ? "✓ \(entry.name)" : entry.name)
                        }
                    }
                }
            }
        } label: {
            Label(model.state.effectiveModel ?? "no model", systemImage: "cpu")
                .font(.system(size: 11))
        }
        .menuStyle(.borderlessButton)
        .frame(maxWidth: 180)
    }
}
