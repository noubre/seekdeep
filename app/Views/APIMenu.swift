import SeekDeepCore
import SwiftUI

/// The OpenAI-compatible endpoint toggle.
///
/// One endpoint, one job: it turns this app into an OpenAI/Anthropic-shaped door onto the
/// room. Every request is forwarded over the DHT to whoever is the room's host, which
/// answers from its own providers — this Mac when it is the host, a remote machine when it
/// is a peer. That is how Claude Code, Codex, Hermes or the OpenAI SDK can use the room's
/// inference without a plugin or any P2P code of their own: they just point their base URL
/// here.
struct APIMenu: View {
    @ObservedObject var model: ChatViewModel
    @State private var port = 8080
    @State private var apiKey = ""

    var body: some View {
        Menu {
            if model.api.running {
                runningControls
            } else {
                startControls
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "circle.fill")
                    .font(.system(size: 7))
                    .foregroundStyle(model.api.running ? Theme.accent : Theme.secondaryText.opacity(0.4))
                Text("API")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.secondaryText)
            }
        }
        .menuStyle(.borderlessButton)
        .disabled(!model.isReady)
        .help(model.api.running ? "OpenAI endpoint running at \(model.api.url ?? "")" : "Serve an OpenAI-compatible endpoint onto the room")
    }

    private var isValidPort: Bool {
        (0...65535).contains(port)
    }

    /// While a server is listening: the URL to point clients at, plus Stop.
    private var runningControls: some View {
        Group {
            Section("Running — the room host's models") {
                if let url = model.api.url {
                    Text(url)
                        .font(.system(size: 11, design: .monospaced))
                        .textSelection(.enabled)
                }
                Button {
                    if let url = model.api.url { copyToPasteboard(url) }
                } label: {
                    Label("Copy URL", systemImage: "doc.on.doc")
                }
                .disabled(model.api.url == nil)
            }
            Divider()
            Button(role: .destructive) {
                Task { await model.stopAPI() }
            } label: {
                Label("Stop", systemImage: "stop.fill")
            }
        }
    }

    /// While stopped: what the endpoint does, the port and optional API key, and Start.
    private var startControls: some View {
        Group {
            Section("OpenAI endpoint — the room host's models") {
                Text("Point Claude Code, Codex, Hermes or any OpenAI client at this URL. Requests are forwarded over the room to whoever is the host; nothing needs installing on that client.")
                    .font(.system(size: 11))
                Button("Start endpoint") {
                    Task { await model.startAPI(port: port, apiKey: apiKey) }
                }
                .disabled(!isValidPort)
            }
            Divider()
            Section("Endpoint") {
                TextField("Port", value: $port, format: .number.grouping(.never))
                SecureField("API key (optional)", text: $apiKey)
            }
        }
    }

    private func copyToPasteboard(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}
