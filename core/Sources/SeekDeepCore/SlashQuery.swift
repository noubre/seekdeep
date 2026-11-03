import Foundation

/// Detects whether the caret sits inside a `/command` token, so the composer can show the
/// matching command list.
///
/// This is deliberately *not* a port of `js/slash/parser.js`: the worker owns argument and
/// flag parsing, and a second implementation would drift. All the UI needs is the word
/// after the leading slash.
public enum SlashQuery {
    /// The command being typed, or `nil` when the caret is not in a command token.
    /// `"/"` alone returns `""` (every command matches).
    public static func command(in text: String, caret: Int) -> String? {
        guard caret >= 0, caret <= text.count else { return nil }
        let prefix = String(text.prefix(caret))
        guard let firstNonSpace = prefix.firstIndex(where: { !$0.isWhitespace }) else { return nil }
        guard prefix[firstNonSpace] == "/" else { return nil }

        let token = prefix[firstNonSpace...].dropFirst()
        guard !token.contains(where: { $0.isWhitespace }) else { return nil }
        return String(token)
    }

    /// Commands matching a query, preserving the input order.
    public static func matches(_ commands: [String], query: String) -> [String] {
        guard !query.isEmpty else { return commands }
        let lowered = query.lowercased()
        return commands.filter { $0.lowercased().hasPrefix(lowered) }
    }
}
