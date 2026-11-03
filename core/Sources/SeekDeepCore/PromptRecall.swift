/// Composer prompt history for the ↑/↓ recall keys, in the style of a shell.
///
/// The app target has no test target, so the walking logic lives here and the view
/// model only glues it to `draft`.
public struct PromptRecall: Sendable, Equatable {
    /// Oldest first. Capped so a long session cannot grow without bound.
    public private(set) var history: [String]
    /// Position in `history` while the user is browsing, or `nil` when browsing is off.
    public private(set) var index: Int?
    /// What the user was typing before the first `previous` of a browse.
    public private(set) var stash: String

    /// Keep at most this many prompts; the oldest is dropped when the cap is exceeded.
    private static let capacity = 50

    public init() {
        history = []
        index = nil
        stash = ""
    }

    /// Appends a sent prompt. Blank text is ignored, an immediate duplicate of the
    /// newest entry is collapsed, and recording always ends any browse in progress.
    public mutating func record(_ prompt: String) {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if history.last != trimmed {
            history.append(trimmed)
            if history.count > Self.capacity {
                history.removeFirst(history.count - Self.capacity)
            }
        }
        index = nil
        stash = ""
    }

    /// Walks to the next-older entry. The first call on a fresh browse stashes
    /// `draft` and returns the newest entry; later calls stop at the oldest.
    /// Returns `nil` only when there is no history to recall.
    public mutating func previous(draft: String) -> String? {
        guard !history.isEmpty else { return nil }
        let target: Int
        if let current = index {
            target = max(current - 1, 0)
        } else {
            stash = draft
            target = history.count - 1
        }
        index = target
        return history[target]
    }

    /// Walks to the next-newer entry. Returns `nil` when not browsing. Moving past
    /// the newest entry restores the stash and turns browsing off.
    public mutating func next(draft: String) -> String? {
        guard let current = index else { return nil }
        // `draft` is part of the API for symmetry with `previous`; the stash from
        // the first `previous` is what gets restored.
        _ = draft
        if current >= history.count - 1 {
            index = nil
            return stash
        }
        index = current + 1
        return history[current + 1]
    }
}
