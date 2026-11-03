import SeekDeepCore
import SwiftUI

/// The OpenAI-compatible endpoint toggle.
///
/// Both modes serve the same HTTP surface (`js/openai/http-server.js`); they differ only
/// in who runs the model — this Mac's providers, or the room's host reached over the DHT.
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
        .help(model.api.running ? "OpenAI endpoint running at \(model.api.url ?? "")" : "Serve an OpenAI-compatible endpoint")
    }

    private var isValidPort: Bool {
        (0...65535).contains(port)
    }

    /// While a server is listening: the URL to point clients at, plus Stop.
    private var runningControls: some View {
        Group {
            Section("Running — \(model.api.mode ?? "api")") {
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

    /// While stopped: one entry per mode, each saying who runs the model, plus the
    /// port and the optional API key both modes share.
    private var startControls: some View {
        Group {
            Section("Server — this Mac runs the model") {
                Text("Answers from the providers set up on this machine (Ollama, LM Studio).")
                    .font(.system(size: 11))
                Button("Start Server") {
                    Task { await model.startAPI(mode: "server", port: port, apiKey: apiKey) }
                }
                .disabled(!isValidPort)
            }
            Section("Bridge — a remote host runs the model") {
                Text("Forwards each request over the room to whoever is the host.")
                    .font(.system(size: 11))
                Button("Start Bridge") {
                    Task { await model.startAPI(mode: "bridge", port: port, apiKey: apiKey) }
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
