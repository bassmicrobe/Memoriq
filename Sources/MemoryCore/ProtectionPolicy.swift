import Foundation

public enum AppProtectionPolicy {
    private static let protectedNames: Set<String> = [
        "cursor", "claude", "chatgpt", "codex", "codex computer use", "docker", "google chrome",
        "google chrome beta", "google chrome canary", "google chrome dev",
        "memoryharbor", "memory harbor", "memoriq"
    ]
    private static let protectedIdentifiers: Set<String> = [
        "com.todesktop.230313mzl4w4u92", "com.anthropic.claudefordesktop",
        "com.openai.chat", "com.openai.codex", "com.docker.docker",
        "com.google.chrome", "jp.local.memoryharbor"
    ]

    public static func isProtected(bundlePath: String) -> Bool {
        guard bundlePath.hasPrefix("/"),
              let rootPath = ProcessGrouping.bundlePath(executablePath: bundlePath) else { return true }
        let normalized = URL(fileURLWithPath: rootPath).standardizedFileURL.resolvingSymlinksInPath()
        if normalized.path.hasPrefix("/System/") || normalized.path.hasPrefix("/Library/") { return true }
        let name = normalized.deletingPathExtension().lastPathComponent.lowercased()
        if protectedNames.contains(name) { return true }
        guard let identifier = Bundle(url: normalized)?.bundleIdentifier?.lowercased() else { return false }
        return protectedIdentifiers.contains(identifier) || identifier.hasPrefix("com.google.chrome.")
    }
}

public enum MemoryPressure {
    // XNU exports dispatch levels via this sysctl, not its internal 0/1/2/3 enum.
    // https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_memorystatus_notify.c
    public static func label(dispatchValue: UInt32) -> String {
        switch dispatchValue {
        case 1: "normal"
        case 2: "warning"
        case 4: "critical"
        default: "unknown"
        }
    }
}
