import CMemoryProbe
import Foundation

struct ProcessSample: Sendable {
    let executablePath: String
    let footprintBytes: UInt64
}

public enum ProcessGrouping {
    public static func bundlePath(executablePath: String) -> String? {
        guard executablePath.hasPrefix("/") else { return nil }
        let components = URL(fileURLWithPath: executablePath).standardizedFileURL.pathComponents
        guard let index = components.firstIndex(where: { $0.lowercased().hasSuffix(".app") }) else { return nil }
        return NSString.path(withComponents: Array(components.prefix(through: index)))
    }

    static func aggregate(_ processes: [ProcessSample]) throws -> [AppMemory] {
        let appProcesses = processes.compactMap { sample -> (String, ProcessSample)? in
            guard let path = bundlePath(executablePath: sample.executablePath) else { return nil }
            return (path, sample)
        }
        let grouped = Dictionary(grouping: appProcesses, by: { $0.0 })
        return try grouped.map { path, samples in
            let footprint = try samples.reduce(UInt64(0)) { total, entry in
                let result = total.addingReportingOverflow(entry.1.footprintBytes)
                guard !result.overflow else { throw MemoryProbeError.overflow }
                return result.partialValue
            }
            return AppMemory(
                id: path,
                name: URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent,
                bundlePath: path,
                footprintBytes: footprint,
                processCount: samples.count,
                protected: AppProtectionPolicy.isProtected(bundlePath: path)
            )
        }.sorted { left, right in
            left.footprintBytes == right.footprintBytes ? left.id < right.id : left.footprintBytes > right.footprintBytes
        }
    }
}

public enum MemorySampler {
    public static func sample() throws -> MemorySnapshot {
        var system = MHSystemMemory()
        let systemError = mh_sample_system(&system)
        guard systemError == 0 else { throw MemoryProbeError.system(systemError) }
        var records: UnsafeMutablePointer<MHProcessRecord>?
        var count = 0
        var unreadable = 0
        let processError = mh_sample_processes(&records, &count, &unreadable)
        guard processError == 0 else { throw MemoryProbeError.processes(processError) }
        defer { mh_free_records(records) }
        let samples = UnsafeBufferPointer(start: records, count: count).map { record in
            let path = withUnsafeBytes(of: record.executable_path) { bytes in
                String(decoding: bytes.prefix(while: { $0 != 0 }), as: UTF8.self)
            }
            return ProcessSample(executablePath: path, footprintBytes: record.footprint_bytes)
        }
        return MemorySnapshot(
            timestamp: ISO8601DateFormatter().string(from: Date()),
            memory: SystemMemory(totalBytes: system.total_bytes, swapUsedBytes: system.swap_used_bytes,
                                 pressure: MemoryPressure.label(dispatchValue: system.pressure_dispatch_value)),
            apps: try ProcessGrouping.aggregate(samples),
            unreadableProcessCount: unreadable
        )
    }
}
