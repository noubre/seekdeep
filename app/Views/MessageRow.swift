import SeekDeepCore
import SwiftUI

struct MessageRow: View {
    let message: ChatMessage
    @State private var showReasoning = false

    /// Reasoning is never shown inline; only the answer is rendered as blocks.
    private var split: ThinkSplit {
        let raw = message.rawContent.isEmpty ? message.content : message.rawContent
        return Thinking.split(raw)
    }

    var body: some View {
        HStack {
            if message.isMine { Spacer(minLength: 60) }
            VStack(alignment: .leading, spacing: 6) {
                header
                if !split.thinking.isEmpty {
                    reasoningBlock(split.thinking, open: split.open)
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

    private var header: some View {
        HStack(spacing: 6) {
            if !message.isMine, !message.author.isEmpty {
                Text(message.author)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.heading)
            }
            Text(message.timestamp.formatted(date: .omitted, time: .shortened))
                .font(.system(size: 10))
                .foregroundStyle(Theme.secondaryText.opacity(0.45))
        }
    }

    /// Collapsed by default — a scratchpad is not an answer — but it opens itself while the
    /// block is still being written, otherwise a long reasoning pass looks like a freeze.
    @ViewBuilder
    private func reasoningBlock(_ text: String, open: Bool) -> some View {
        DisclosureGroup(isExpanded: $showReasoning) {
            Text(text)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(Theme.accent.opacity(0.85))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 4)
        } label: {
            Text(open ? "Reasoning…" : "Reasoning")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Theme.accent.opacity(0.85))
        }
        .onAppear { if open { showReasoning = true } }
        .onChange(of: open) { _, stillOpen in if stillOpen { showReasoning = true } }
    }

    @ViewBuilder
    private var content: some View {
        let blocks = MarkdownBlock.parse(split.answer)
        if blocks.isEmpty && !message.isComplete {
            ProgressView().controlSize(.small)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                    blockView(block)
                }
                if !message.isComplete {
                    ProgressView().controlSize(.small)
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
            CodeBlock(source: source)
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

private struct CodeBlock: View {
    let source: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("code")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(Theme.secondaryText.opacity(0.4))
                Spacer()
                Button(copied ? "Copied" : "Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(source, forType: .string)
                    copied = true
                    Task {
                        try? await Task.sleep(for: .seconds(1.2))
                        copied = false
                    }
                }
                .buttonStyle(.plain)
                .font(.system(size: 10))
                .foregroundStyle(Theme.accent)
            }
            Text(source)
                .font(.system(size: 12, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(8)
        .background(Color.black.opacity(0.25))
        .clipShape(RoundedRectangle(cornerRadius: 6))
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
