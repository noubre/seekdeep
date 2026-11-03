import SeekDeepCore
import SwiftUI

/// Shown above the transcript whenever a saved session is open. The room keeps running
/// behind it, so this bar is the only way back and says so.
struct HistoryBar: View {
    let name: String
    let count: Int
    let unread: Int
    let close: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "clock.arrow.circlepath")
                .foregroundStyle(Theme.warning)
            Text("History · \(name)")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(1)
            Text("\(count) messages · read-only")
                .font(.system(size: 11))
                .foregroundStyle(Theme.secondaryText.opacity(0.65))
            if unread > 0 {
                Text("· +\(unread) new")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.warning)
            }
            Spacer()
            Button("Back to room", action: close)
                .buttonStyle(.borderless)
                .font(.system(size: 11))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Theme.chrome)
    }
}
