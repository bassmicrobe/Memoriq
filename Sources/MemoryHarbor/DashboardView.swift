import AppKit
import MemoryCore
import SwiftUI

struct DashboardView: View {
    @ObservedObject var monitor: MemoryMonitor

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Image(systemName: "memorychip").font(.title2).foregroundStyle(.teal)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Memoriq").font(.headline)
                    Text("Mac全体とChromeを、軽く。").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button(action: monitor.refresh) { Image(systemName: "arrow.clockwise") }
                    .disabled(monitor.isRefreshing).help("使用量を更新")
            }
            if let snapshot = monitor.snapshot {
                summary(snapshot)
                HStack {
                    Text("アプリ別の使用量").font(.headline)
                    Spacer()
                    Text("30秒ごとに更新").font(.caption).foregroundStyle(.secondary)
                }
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(snapshot.apps.prefix(18)) { app in
                            appRow(app)
                            Divider()
                        }
                    }
                }.frame(height: 310)
                Text("圧縮分を含むメモリ負担の目安です。共有領域などがあるため、合計はMac全体の使用量とは一致しません。")
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if snapshot.unreadableProcessCount > 0 {
                    Text("読み取れないプロセス: \(snapshot.unreadableProcessCount)件（一部は表示対象外）")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            } else {
                ProgressView("メモリを確認中…").frame(maxWidth: .infinity)
            }
            if let message = monitor.message {
                Text(message).font(.caption).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 8) {
                Button(action: monitor.openExtension) {
                    Label("Chromeのタブ整理を開く", systemImage: "rectangle.on.rectangle")
                        .frame(maxWidth: .infinity)
                }.buttonStyle(.borderedProminent).tint(.teal)
                Text("拡張で許可したサイトの未使用タブを解放します。他のアプリは使用量の確認と通常終了に対応します。")
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Button("拡張フォルダ", action: monitor.revealExtension)
                Spacer()
                Button("Memoriqを終了") { NSApplication.shared.terminate(nil) }
            }.font(.caption)
        }
        .padding(20)
        .frame(width: 430)
    }

    private func summary(_ snapshot: MemorySnapshot) -> some View {
        HStack(alignment: .top) {
            metric("メモリ圧迫", pressureLabel(snapshot.memory.pressure), color: pressureColor(snapshot.memory.pressure))
            Spacer()
            metric("スワップ", bytes(snapshot.memory.swapUsedBytes))
            Spacer()
            metric("搭載RAM", bytes(snapshot.memory.totalBytes))
        }
        .padding(14)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }

    private func metric(_ title: String, _ value: String, color: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.headline).foregroundStyle(color)
        }
    }

    private func appRow(_ app: AppMemory) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(app.name).lineLimit(1).font(.system(size: 13, weight: .medium))
                Text("\(app.processCount)プロセス").font(.caption2).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Text(bytes(app.footprintBytes)).monospacedDigit().font(.system(size: 13))
            if app.protected {
                Image(systemName: "lock.shield").foregroundStyle(.secondary)
                    .frame(width: 55).help("作業を守るため、このアプリから終了しません")
            } else {
                Button("終了…") { monitor.requestQuit(app) }.font(.caption).frame(width: 55)
            }
        }.padding(.vertical, 9)
    }

    private func bytes(_ value: UInt64) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(clamping: value), countStyle: .binary)
    }

    private func pressureLabel(_ value: String) -> String {
        switch value {
        case "normal": "正常"
        case "warning": "高め"
        case "critical": "非常に高い"
        default: "取得不可"
        }
    }

    private func pressureColor(_ value: String) -> Color {
        switch value {
        case "normal": .teal
        case "warning": .orange
        case "critical": .red
        default: .secondary
        }
    }
}
