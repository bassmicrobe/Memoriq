import Foundation

public struct RestSession: Equatable, Sendable {
    public let apps: [AppMemory]

    public init(apps: [AppMemory] = []) { self.apps = apps }

    public func recording(_ app: AppMemory, runningBundlePaths: Set<String>) throws -> RestSession {
        guard !app.protected, !AppProtectionPolicy.isProtected(bundlePath: app.bundlePath) else {
            throw RestError.protectedApp
        }
        guard !runningBundlePaths.contains(app.bundlePath) else { throw RestError.stillRunning }
        return RestSession(apps: apps.filter { $0.bundlePath != app.bundlePath } + [app])
    }

    public func removing(bundlePath: String) -> RestSession {
        RestSession(apps: apps.filter { $0.bundlePath != bundlePath })
    }

    public func reconciled(runningBundlePaths: Set<String>) -> RestSession {
        RestSession(apps: apps.filter { !runningBundlePaths.contains($0.bundlePath) })
    }
}

public enum RestError: Error, LocalizedError {
    case protectedApp, stillRunning

    public var errorDescription: String? {
        switch self {
        case .protectedApp: "このアプリは休止操作から保護されています。"
        case .stillRunning: "アプリがまだ動いています。保存確認などを確認してください。"
        }
    }
}
