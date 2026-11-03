import SeekDeepCore
import SwiftUI

struct MessageList: View {
    let messages: [ChatMessage]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(messages) { message in
                        MessageRow(message: message)
                            .id(message.id)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: messageCount) { _, _ in
                guard let last = messages.last?.id else { return }
                withAnimation(.easeOut(duration: 0.15)) {
                    proxy.scrollTo(last, anchor: .bottom)
                }
            }
        }
        .background(Theme.canvas)
    }

    /// Streaming appends a chunk to the *last* message without changing its id, so the
    /// scroll trigger watches the content length instead.
    private var messageCount: Int {
        messages.reduce(0) { $0 + $1.rawContent.count }
    }
}
