import Foundation

public struct ThinkSplit: Sendable, Equatable {
    public let thinking: String
    public let answer: String
    public let open: Bool

    public init(thinking: String, answer: String, open: Bool) {
        self.thinking = thinking
        self.answer = answer
        self.open = open
    }
}

/// Port of `js/messages/thinking.js`: reasoning arrives wrapped in think tags, and while
/// streaming an unterminated block must stay out of the visible answer.
public enum Thinking {
    // Written as concatenations so the literals cannot be mangled by tooling that treats
    // angle brackets as markup.
    static let openTag = "<" + "think" + ">"
    static let closeTag = "<" + "/think" + ">"

    public static func split(_ text: String) -> ThinkSplit {
        var thinking = ""
        var answer = ""
        var index = text.startIndex

        while index < text.endIndex {
            guard let start = text.range(of: openTag, range: index..<text.endIndex) else {
                answer += text[index...]
                break
            }
            answer += text[index..<start.lowerBound]
            let bodyStart = start.upperBound

            guard let close = text.range(of: closeTag, range: bodyStart..<text.endIndex) else {
                return ThinkSplit(thinking: String(text[bodyStart...]), answer: answer, open: true)
            }
            thinking = String(text[bodyStart..<close.lowerBound])
            index = close.upperBound
        }

        return ThinkSplit(thinking: thinking, answer: answer, open: false)
    }
}
