import Foundation

public struct SystemMemory: Codable, Equatable, Sendable {
    public let totalBytes: UInt64
    public let swapUsedBytes: UInt64
    public let pressure: String

    public init(totalBytes: UInt64, swapUsedBytes: UInt64, pressure: String) {
        self.totalBytes = totalBytes
        self.swapUsedBytes = swapUsedBytes
        self.pressure = pressure
    }
}

public struct AppMemory: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let bundlePath: String
    public let footprintBytes: UInt64
    public let processCount: Int
    public let protected: Bool

    public init(id: String, name: String, bundlePath: String, footprintBytes: UInt64,
                processCount: Int, protected: Bool) {
        self.id = id
        self.name = name
        self.bundlePath = bundlePath
        self.footprintBytes = footprintBytes
        self.processCount = processCount
        self.protected = protected
    }
}

public struct MemorySnapshot: Codable, Equatable, Sendable {
    public let timestamp: String
    public let memory: SystemMemory
    public let apps: [AppMemory]
    public let unreadableProcessCount: Int

    public init(timestamp: String, memory: SystemMemory, apps: [AppMemory], unreadableProcessCount: Int) {
        self.timestamp = timestamp
        self.memory = memory
        self.apps = apps
        self.unreadableProcessCount = unreadableProcessCount
    }
}

public enum MemoryProbeError: Error, LocalizedError {
    case system(Int32)
    case processes(Int32)
    case overflow

    public var errorDescription: String? {
        switch self {
        case .system(let code): "Macのメモリ統計を取得できませんでした（\(code)）。"
        case .processes(let code): "アプリのメモリ使用量を取得できませんでした（\(code)）。"
        case .overflow: "メモリ使用量が測定可能な範囲を超えました。"
        }
    }
}
