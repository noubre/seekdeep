import SwiftUI

/// Palette lifted from the current `css/app.css` so the port looks like the thing it
/// replaces rather than a generic macOS app.
enum Theme {
    static let chrome = Color(hex: 0x171C27)
    static let canvas = Color(hex: 0x232834)
    static let userBubble = Color(hex: 0x4A6BBF)
    static let assistantBubble = Color(hex: 0x3B4252)
    static let systemBubble = Color(hex: 0x4C566A)
    static let accent = Color(hex: 0x81A1C1)
    static let ephemeral = Color(hex: 0x2B3445)
    static let danger = Color(hex: 0xBF616A)
    static let warning = Color(hex: 0xEBCB8B)
    static let secondaryText = Color(hex: 0xD8DEE9)
    static let heading = Color(hex: 0x88C0D0)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}
