import SeekDeepCore
import SwiftUI

struct MessageRow: View {
    let message: ChatMessage

    /// Reasoning is never shown inline; only the answer is rendered as blocks.
    private var answer: String {
        let raw = message.rawContent.isEmpty ? message.content : message.rawContent
        return Thinking.split(raw).answer
    }

    private var reasoning: String {
        let raw = message.rawContent.isEmpty ? message.rawContent : message.rawContent
        return Thinking.split(raw).thinking
    }

    var body: some View {
        HStack {
            if message.isMine { Spacer(minLength: 60) }
            VStack(alignment: .leading, spacing: 6) {
                if !message.isMine && !message.author.isEmpty {
                    Text(message.author)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.heading)
                }
                if !reasoning.isEmpty {
                    Text(reasoning)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Theme.accent.opacity(0.8))
                        .lineLimit(4)
                }
                content
            }
            .padding(10)
            .background(bubbleColor)
            .foregroundStyle(Theme.secondaryText)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            if !message.isMine { Spacer(minLength: 60) }
        }
    }

    @ViewBuilder
    private var content: some View {
        let blocks = MarkdownBlock.parse(answer)
        if blocks.isEmpty && !message.isComplete {
            ProgressView().controlSize(.small)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                    blockView(block)
                }
            }
        }
    }

    @ViewBuilder
    private func blockView(_ block: MarkdownBlock.Block) -> some View {
        switch block {
        case .paragraph(let text):
            Text(inline(text)).textSelection(.enabled)
        case .heading(let level, let text):
            Text(inline(text))
                .font(.system(size: level == 1 ? 16 : 14, weight: .semibold))
                .foregroundStyle(Theme.heading)
                .textSelection(.enabled)
        case .bulletList(let items):
            VStack(alignment: .leading, spacing: 3) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    Text("• " + inline(item)).textSelection(.enabled)
                }
            }
        case .code(let source):
            Text(source)
                .font(.system(size: 12, design: .monospaced))
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.black.opacity(0.25))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .textSelection(.enabled)
        }
    }

    private func inline(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }

    private var bubbleColor: Color {
        switch message.kind {
        case .user: return Theme.userBubble
        case .assistant: return Theme.assistantBubble
        case .system, .bot: return Theme.systemBubble
        }
    }
}

private extension ChatMessage {
    var isMine: Bool { kind == .user }

    var author: String {
        if let peer = fromPeer, !peer.isEmpty { return peer }
        switch kind {
        case .assistant: return "Assistant"
        case .system: return "System"
        case .bot: return "Bot"
        case .user: return ""
        }
    }
}
