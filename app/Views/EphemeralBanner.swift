import SeekDeepCore
import SwiftUI

struct EphemeralBanner: View {
    let banner: Ephemeral
    let dismiss: () -> Void

    private var tint: Color {
        switch banner.kind {
        case "slash-error": return Theme.danger
        case "slash-placeholder": return Theme.secondaryText
        default: return Theme.accent
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(banner.content)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(tint)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: dismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 10))
            }
            .buttonStyle(.borderless)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.ephemeral)
    }
}
