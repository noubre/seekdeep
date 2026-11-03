import Foundation

/// Markdown export of a transcript, for the "Export" menu item.
public enum Transcript {
    public static func markdown(_ messages: [ChatMessage], topic: String?, date: Date = Date()) -> String {
        var lines: [String] = []
        lines.append("# SeekDeep transcript")
        lines.append("")
        if let topic, !topic.isEmpty {
            lines.append("Topic: `\(topic)`")
        }
        lines.append("Exported: \(ISO8601DateFormatter().string(from: date))")
        lines.append("")
        for message in messages {
            let who = message.fromPeer ?? message.kind.rawValue.capitalized
            let stamp = Self.formatter.string(from: message.timestamp)
            lines.append("## \(who) — \(stamp)")
            lines.append("")
            lines.append(message.body.isEmpty ? message.content : message.body)
            lines.append("")
        }
        return lines.joined(separator: "\n")
    }

    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        // UTC on purpose: a transcript that says "14:03" without an offset is ambiguous,
        // and a fixed zone keeps the output deterministic for tests.
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss 'UTC'"
        return formatter
    }()
}

private extension ChatMessage {
    /// Whatever the bubble actually shows: the answer without its reasoning block.
    var body: String { Thinking.split(rawContent).answer.trimmingCharacters(in: .whitespacesAndNewlines) }
}
