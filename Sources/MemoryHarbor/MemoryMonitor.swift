import AppKit
import Combine
import Foundation
import MemoryCore

@MainActor
final class MemoryMonitor: ObservableObject {
    @Published private(set) var snapshot: MemorySnapshot?
    @Published private(set) var message: String?
    @Published private(set) var isRefreshing = false
    private var timer: Timer?

    init() {
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        timer?.tolerance = 5
    }

    var statusIcon: String {
        switch snapshot?.memory.pressure {
        case "warning", "critical": "exclamationmark.triangle"
        default: "memorychip"
        }
    }

    func refresh() {
        guard !isRefreshing else { return }
        isRefreshing = true
        Task {
            defer { isRefreshing = false }
            do {
                let result = try await Task.detached(priority: .utility) {
                    try MemorySampler.sample()
                }.value
                snapshot = result
            } catch {
                message = "メモリ情報の取得に失敗しました。更新をお試しください。"
                NSLog("Memoriq sample failed: %@", String(describing: error))
            }
        }
    }

    func openExtension() {
        guard let id = Bundle.main.object(forInfoDictionaryKey: "MemoryHarborExtensionID") as? String,
              id.count == 32, id.allSatisfy({ ("a"..."p").contains(String($0)) }),
              let url = URL(string: "chrome-extension://\(id)/popup.html"),
              let chrome = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.google.Chrome") else {
            message = "Chromeまたは拡張の情報が見つかりません。付属のREADMEを確認してください。"
            return
        }
        NSWorkspace.shared.open([url], withApplicationAt: chrome, configuration: .init()) { _, error in
            if let error {
                NSLog("Memoriq open extension: %@", String(describing: error))
                Task { @MainActor in self.message = "拡張を開けません。Chromeへ拡張を読み込んでください。" }
            }
        }
    }

    func revealExtension() {
        guard let resources = Bundle.main.resourceURL else { return }
        NSWorkspace.shared.activateFileViewerSelecting([resources.appendingPathComponent("extension")])
    }

    func requestQuit(_ app: AppMemory) {
        guard !AppProtectionPolicy.isProtected(bundlePath: app.bundlePath), !app.protected else {
            message = "このアプリは終了操作から保護されています。"
            return
        }
        let targets = NSWorkspace.shared.runningApplications.filter {
            $0.bundleURL?.standardizedFileURL.path == URL(fileURLWithPath: app.bundlePath).standardizedFileURL.path
                && $0.processIdentifier != ProcessInfo.processInfo.processIdentifier
                && $0.activationPolicy == .regular
        }
        guard !targets.isEmpty else {
            message = "アプリの実行状態が変わりました。情報を更新します。"
            refresh()
            return
        }
        let alert = NSAlert()
        alert.messageText = "\(app.name)を通常終了しますか？"
        alert.informativeText = "通知・通話・処理も停止します。必要な作業を保存してください。アプリが終了を拒否した場合、強制終了はしません。"
        alert.addButton(withTitle: "キャンセル")
        alert.addButton(withTitle: "終了する")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertSecondButtonReturn else { return }
        guard !AppProtectionPolicy.isProtected(bundlePath: app.bundlePath) else { return }
        let results = targets.filter { !$0.isTerminated }.map { $0.terminate() }
        message = results.isEmpty ? "アプリはすでに終了しています。" :
            results.allSatisfy { $0 } ? "通常終了を要求しました。保存確認が表示された場合は対応してください。" :
            "アプリが終了要求を受け付けませんでした。アプリ側で状態を確認してください。"
        refresh()
    }
}
