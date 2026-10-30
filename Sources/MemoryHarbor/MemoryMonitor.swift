import AppKit
import Combine
import Foundation
import MemoryCore

@MainActor
final class MemoryMonitor: ObservableObject {
    @Published private(set) var snapshot: MemorySnapshot?
    @Published private(set) var message: String?
    @Published private(set) var isRefreshing = false
    @Published private(set) var restSession = RestSession()
    @Published private(set) var restingPaths: Set<String> = []
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
                restSession = restSession.reconciled(runningBundlePaths: Set(result.apps.map(\.bundlePath)))
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
        guard !restingPaths.contains(app.bundlePath) else { return }
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
        alert.messageText = "\(app.name)を休ませますか？"
        alert.informativeText = "通常終了してメモリを返し、後でMemoriqから再起動できます。通知・通話・処理も停止します。必要な作業を保存してください。ウインドウや編集中の状態の自動復元は保証しません。終了を拒否した場合は強制終了しません。"
        alert.addButton(withTitle: "キャンセル")
        alert.addButton(withTitle: "保存してから休ませる")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertSecondButtonReturn else { return }
        guard !AppProtectionPolicy.isProtected(bundlePath: app.bundlePath) else { return }
        restingPaths = restingPaths.union([app.bundlePath])
        let results = targets.filter { !$0.isTerminated }.map { $0.terminate() }
        guard results.allSatisfy({ $0 }) else {
            restingPaths = restingPaths.subtracting([app.bundlePath])
            message = "アプリが終了要求を受け付けませんでした。アプリ側で状態を確認してください。"
            refresh()
            return
        }
        message = "終了を確認しています。保存確認が表示された場合は対応してください。"
        Task { await confirmRest(app) }
    }

    private func confirmRest(_ app: AppMemory) async {
        defer { restingPaths = restingPaths.subtracting([app.bundlePath]) }
        do {
            for _ in 0..<10 {
                try await Task.sleep(for: .seconds(2))
                let current = try await Task.detached(priority: .utility) { try MemorySampler.sample() }.value
                snapshot = current
                let running = Set(current.apps.map(\.bundlePath))
                if !running.contains(app.bundlePath) {
                    restSession = try restSession.recording(app, runningBundlePaths: running)
                    message = "\(app.name)のプロセス終了を確認しました。下の一覧から再起動できます。"
                    return
                }
            }
            message = "\(app.name)がまだ動いています。保存確認などを確認してください。休止済みには数えていません。"
        } catch {
            NSLog("Memoriq rest verification failed: %@", String(describing: error))
            message = "終了状態を確認できませんでした。アプリの状態を確認してください。"
        }
    }

    func reopen(_ app: AppMemory) {
        guard restSession.apps.contains(where: { $0.bundlePath == app.bundlePath }),
              !AppProtectionPolicy.isProtected(bundlePath: app.bundlePath),
              let bundle = Bundle(path: app.bundlePath), bundle.executableURL != nil else {
            message = "再起動できるアプリが見つかりません。Finderで確認してください。"
            return
        }
        NSWorkspace.shared.openApplication(at: bundle.bundleURL, configuration: .init()) { application, error in
            Task { @MainActor in
                guard error == nil, application != nil else {
                    NSLog("Memoriq reopen failed: %@", String(describing: error))
                    self.message = "\(app.name)を起動できませんでした。一覧に残してあります。"
                    return
                }
                self.restSession = self.restSession.removing(bundlePath: app.bundlePath)
                self.message = "\(app.name)を起動しました。"
                self.refresh()
            }
        }
    }
}
