import Foundation
import XCTest
@testable import MemoryCore

final class SamplingTests: XCTestCase {
    func testAppFootprintIncludesHelpersAndSeparatesOtherApps() throws {
        let samples = [
            ProcessSample(executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", footprintBytes: 100),
            ProcessSample(executablePath: "/Applications/Google Chrome.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper", footprintBytes: 250),
            ProcessSample(executablePath: "/Applications/Discord.app/Contents/MacOS/Discord", footprintBytes: 75),
            ProcessSample(executablePath: "/usr/bin/python3", footprintBytes: 900)
        ]
        let apps = try ProcessGrouping.aggregate(samples)
        XCTAssertEqual(apps.count, 2)
        XCTAssertEqual(apps[0].name, "Google Chrome")
        XCTAssertEqual(apps[0].footprintBytes, 350)
        XCTAssertEqual(apps[0].processCount, 2)
        XCTAssertTrue(apps[0].protected)
        XCTAssertEqual(apps[1].name, "Discord")
        XCTAssertEqual(apps[1].footprintBytes, 75)
        XCTAssertEqual(apps[1].processCount, 1)
        XCTAssertFalse(apps[1].protected)
    }

    func testAggregationRejectsOverflowInsteadOfMisreportingZero() {
        let samples = [
            ProcessSample(executablePath: "/Applications/Example.app/main", footprintBytes: UInt64.max),
            ProcessSample(executablePath: "/Applications/Example.app/helper", footprintBytes: 1)
        ]
        XCTAssertThrowsError(try ProcessGrouping.aggregate(samples))
    }

    func testEmptyProcessListProducesAnEmptyAppList() throws {
        XCTAssertEqual(try ProcessGrouping.aggregate([]), [])
    }

    func testSnapshotSerializesExpectedWireFieldsAndValues() throws {
        let snapshot = MemorySnapshot(
            timestamp: "2026-10-28T06:00:00Z",
            memory: SystemMemory(totalBytes: 34_359_738_368, swapUsedBytes: 2_147_483_648, pressure: "warning"),
            apps: [AppMemory(id: "/Applications/Example.app", name: "Example", bundlePath: "/Applications/Example.app",
                             footprintBytes: 268_435_456, processCount: 3, protected: false)],
            unreadableProcessCount: 2
        )
        let data = try JSONEncoder().encode(snapshot)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let memory = try XCTUnwrap(json["memory"] as? [String: Any])
        let apps = try XCTUnwrap(json["apps"] as? [[String: Any]])
        XCTAssertEqual(memory["pressure"] as? String, "warning")
        XCTAssertEqual(memory["totalBytes"] as? UInt64, 34_359_738_368)
        XCTAssertEqual(apps[0]["footprintBytes"] as? UInt64, 268_435_456)
        XCTAssertEqual(apps[0]["protected"] as? Bool, false)
        XCTAssertEqual(json["unreadableProcessCount"] as? Int, 2)
        XCTAssertEqual(try JSONDecoder().decode(MemorySnapshot.self, from: data), snapshot)
    }

    func testReadOnlyLiveSamplerReportsInstalledRAMAndValidAppMeasurements() throws {
        let snapshot = try MemorySampler.sample()
        XCTAssertEqual(snapshot.memory.totalBytes, ProcessInfo.processInfo.physicalMemory)
        XCTAssertNotNil(ISO8601DateFormatter().date(from: snapshot.timestamp))
        XCTAssertTrue(["normal", "warning", "critical", "unknown"].contains(snapshot.memory.pressure))
        XCTAssertGreaterThanOrEqual(snapshot.unreadableProcessCount, 0)
        XCTAssertTrue(snapshot.apps.allSatisfy { $0.processCount > 0 && $0.bundlePath.hasPrefix("/") })
        XCTAssertEqual(Set(snapshot.apps.map(\.id)).count, snapshot.apps.count)
    }
}
