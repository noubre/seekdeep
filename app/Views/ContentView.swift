import SeekDeepCore
import SwiftUI

struct ContentView: View {
    @ObservedObject var model: ChatViewModel

    var body: some View {
        VStack(spacing: 0) {
            TopBar(model: model)
            JoinBar(model: model)
            Divider().overlay(Color.black.opacity(0.4))

            if let history = model.state.history {
                HistoryBar(name: history.name, count: history.messages.count, close: model.closeHistory)
            }

            if model.state.displayMessages.isEmpty {
                EmptyState(state: model.state)
            } else {
                MessageList(messages: model.state.displayMessages)
            }

            if let banner = model.state.ephemeral {
                EphemeralBanner(banner: banner, dismiss: model.dismissBanner)
                    .task(id: banner.createdAt) {
                        // Only transient banners expire; errors stay until dismissed.
                        try? await Task.sleep(for: .seconds(ChatReducer.ephemeralLifetime + 0.5))
                        model.expireBannerIfNeeded()
                    }
            }

            Composer(model: model)
        }
        .background(Theme.canvas)
        .preferredColorScheme(.dark)
        .frame(minWidth: 560, minHeight: 420)
    }
}

struct EmptyState: View {
    let state: ChatState

    var body: some View {
        VStack(spacing: 10) {
            Spacer()
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 28))
                .foregroundStyle(Theme.accent.opacity(0.7))
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.secondaryText)
            Text(detail)
                .font(.system(size: 12))
                .foregroundStyle(Theme.secondaryText.opacity(0.6))
                .multilineTextAlignment(.center)
                .frame(maxWidth: 380)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.canvas)
    }

    private var title: String {
        switch state.emptyReason {
        case .noProvider: return "No model server"
        case .noModel: return "No models available"
        case .noHost: return "Waiting for the host"
        case nil: return "Say something"
        }
    }

    private var detail: String {
        switch state.emptyReason {
        case .noProvider: return "Start Ollama (or LM Studio), then press refresh in the top bar."
        case .noModel: return "The provider answered but returned no models."
        case .noHost: return "You have joined a room; messages appear once the host is reachable."
        case nil: return "Private by default. / for commands, ⌘↩ to send."
        }
    }
}
