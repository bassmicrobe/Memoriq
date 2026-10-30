import MemoryCore
import SwiftUI

struct RestedAppsView: View {
    let apps: [AppMemory]
    let reopen: (AppMemory) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("休ませたアプリ").font(.system(size: 12, weight: .semibold))
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(apps) { app in
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(app.name).font(.system(size: 12)).lineLimit(1)
                                Text("終了前 \(NeonTheme.bytes(app.footprintBytes))")
                                    .font(.system(size: 10)).foregroundStyle(NeonTheme.muted)
                            }
                            Spacer()
                            Button("再起動") { reopen(app) }
                                .buttonStyle(NeonButtonStyle(compact: true))
                        }
                    }
                }
            }.frame(maxHeight: 90)
            Text("再起動の一覧はMemoriqを終了するまで保持します。")
                .font(.system(size: 9)).foregroundStyle(NeonTheme.muted)
        }
        .foregroundStyle(NeonTheme.text)
        .padding(12)
        .background(NeonTheme.surface, in: RoundedRectangle(cornerRadius: 8))
    }
}
