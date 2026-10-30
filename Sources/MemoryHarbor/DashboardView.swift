import AppKit
import MemoryCore
import SwiftUI

struct DashboardView: View {
    @ObservedObject var monitor: MemoryMonitor

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            header
            if let snapshot = monitor.snapshot {
                summary(snapshot)
                applications(snapshot)
            } else {
                ProgressView("メモリを確認中…")
                    .tint(NeonTheme.lime)
                    .frame(maxWidth: .infinity, minHeight: 180)
            }
            if let message = monitor.message {
                Text(message)
                    .font(.system(size: 11))
                    .foregroundStyle(NeonTheme.amber)
                    .fixedSize(horizontal: false, vertical: true)
            }
            extensionAction
            if !monitor.restSession.apps.isEmpty {
                RestedAppsView(apps: monitor.restSession.apps, reopen: monitor.reopen)
            }
            footer
        }
        .padding(24)
        .frame(width: 490)
        .background(NeonTheme.background)
        .foregroundStyle(NeonTheme.text)
        .tint(NeonTheme.lime)
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        HStack(spacing: 12) {
            MemoriqMark()
            VStack(alignment: .leading, spacing: 2) {
                Text("MEMORY CONTROL")
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .tracking(2)
                    .foregroundStyle(NeonTheme.muted)
                Text("Memoriq")
                    .font(.system(size: 28, weight: .semibold, design: .rounded))
                    .tracking(-1)
            }
            Spacer()
            Button(action: monitor.refresh) {
                Image(systemName: "arrow.clockwise").frame(width: 16, height: 16)
            }
            .buttonStyle(NeonButtonStyle(compact: true))
            .disabled(monitor.isRefreshing)
            .help("使用量を更新")
            .accessibilityLabel("使用量を更新")
        }
    }

    private func summary(_ snapshot: MemorySnapshot) -> some View {
        HStack(spacing: 0) {
            metric("メモリ圧迫", pressureLabel(snapshot.memory.pressure),
                   color: NeonTheme.pressureColor(snapshot.memory.pressure))
            Rectangle().fill(NeonTheme.line).frame(width: 1, height: 40).padding(.horizontal, 18)
            metric("スワップ", NeonTheme.bytes(snapshot.memory.swapUsedBytes), color: NeonTheme.lilac)
            Spacer(minLength: 10)
            metric("搭載RAM", NeonTheme.bytes(snapshot.memory.totalBytes))
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NeonTheme.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NeonTheme.line))
    }

    private func metric(_ title: String, _ value: String, color: Color = NeonTheme.text) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 10)).foregroundStyle(NeonTheme.muted)
            Text(value)
                .font(.system(size: 19, weight: .medium, design: .monospaced))
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }

    private func applications(_ snapshot: MemorySnapshot) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("アプリ別の使用量").font(.system(size: 13, weight: .semibold))
                Spacer()
                HStack(spacing: 5) {
                    Circle().fill(NeonTheme.lime).frame(width: 5, height: 5)
                    Text("30秒ごとに更新").font(.system(size: 10))
                }
                .foregroundStyle(NeonTheme.muted)
            }
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(Array(snapshot.apps.prefix(18).enumerated()), id: \.element.id) { index, app in
                        AppMemoryRow(app: app, rank: index + 1) { monitor.requestQuit(app) }
                            .disabled(monitor.restingPaths.contains(app.bundlePath))
                    }
                }
            }
            .frame(height: monitor.restSession.apps.isEmpty ? 295 : 160)
            VStack(alignment: .leading, spacing: 5) {
                Text("圧縮分を含むメモリ負担の目安です。共有領域などがあるため、合計はMac全体の使用量とは一致しません。")
                if snapshot.unreadableProcessCount > 0 {
                    Text("読み取れないプロセス: \(snapshot.unreadableProcessCount)件（一部は表示対象外）")
                }
            }
            .font(.system(size: 10))
            .foregroundStyle(NeonTheme.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var extensionAction: some View {
        VStack(alignment: .leading, spacing: 9) {
            Button(action: monitor.openExtension) {
                HStack {
                    Image(systemName: "rectangle.on.rectangle")
                    Text("Chromeのタブを管理")
                    Spacer()
                    Image(systemName: "arrow.up.right")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(NeonButtonStyle(prominent: true))
            Text("Chromeはタブを休止。他のアプリは「休止…」で通常終了し、あとで再起動できます。")
                .font(.system(size: 10))
                .foregroundStyle(NeonTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var footer: some View {
        HStack {
            Button("拡張フォルダ", action: monitor.revealExtension)
            Spacer()
            Button("Memoriqを終了") { NSApplication.shared.terminate(nil) }
        }
        .buttonStyle(.plain)
        .font(.system(size: 10))
        .foregroundStyle(NeonTheme.muted)
        .padding(.top, 12)
        .overlay(alignment: .top) { Rectangle().fill(NeonTheme.line).frame(height: 1) }
    }

    private func pressureLabel(_ value: String) -> String {
        switch value {
        case "normal": "正常"
        case "warning": "高め"
        case "critical": "非常に高い"
        default: "取得不可"
        }
    }
}
