import Foundation

/// Minimal stderr logging. SwiftUI's `print` goes to stdout, which is invisible when the
/// app is launched from Finder, and the unified log hides the interesting failures behind
/// a predicate. One line per lifecycle event is worth the eight lines of code.
enum AppLog {
    static func note(_ message: String) {
        write("note", message)
    }

    static func fail(_ message: String) {
        write("fail", message)
    }

    private static func write(_ level: String, _ message: String) {
        FileHandle.standardError.write(Data("[seekdeep] \(level): \(message)\n".utf8))
    }
}
