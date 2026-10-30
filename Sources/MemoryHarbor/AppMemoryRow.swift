import MemoryCore
import SwiftUI

struct AppMemoryRow: View {
    let app: AppMemory
    let rank: Int
    let onQuit: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text(String(format: "%02d", rank))
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(NeonTheme.muted)
                .frame(width: 18)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(app.name)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(NeonTheme.text)
                    .lineLimit(1)
                Text("\(app.processCount) プロセス")
                    .font(.system(size: 10))
                    .foregroundStyle(NeonTheme.muted)
            }
            Spacer(minLength: 8)
            Text(NeonTheme.bytes(app.footprintBytes))
                .font(.system(size: 13, weight: .medium, design: .monospaced))
                .foregroundStyle(rank == 1 ? NeonTheme.lime : NeonTheme.text)
                .fixedSize()
            Group {
                if app.protected {
                    Image(systemName: "lock")
                        .font(.system(size: 11))
                        .foregroundStyle(NeonTheme.muted)
                        .frame(width: 50)
                        .help("作業を守るため、このアプリから終了しません")
                        .accessibilityLabel("終了から保護")
                } else {
                    Button("休止…", action: onQuit)
                        .buttonStyle(NeonButtonStyle(compact: true))
                }
            }
        }
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) { Rectangle().fill(NeonTheme.line).frame(height: 1) }
    }
}
