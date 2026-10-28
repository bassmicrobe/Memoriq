import Foundation
import XCTest
@testable import MemoryCore

final class PolicyAndProtocolTests: XCTestCase {
    func testCodexComputerUseAndMemoriqAreProtectedWithoutInstalledBundles() {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("memoriq-policy-\(UUID().uuidString)").path
        XCTAssertFalse(FileManager.default.fileExists(atPath: root))
        for name in ["Codex Computer Use", "Memoriq"] {
            let bundlePath = "\(root)/\(name).app"
            XCTAssertTrue(AppProtectionPolicy.isProtected(bundlePath: bundlePath), name)
            XCTAssertTrue(AppProtectionPolicy.isProtected(bundlePath: "\(bundlePath)/Contents/Helpers/Worker.app"), name)
        }
    }

    func testProtectedAppsAndDescendantsCannotBeOfferedForTermination() {
        let protected = ["Cursor", "Claude", "ChatGPT", "Codex", "Docker", "Google Chrome", "MemoryHarbor"]
        for name in protected {
            XCTAssertTrue(AppProtectionPolicy.isProtected(bundlePath: "/Applications/\(name).app"), name)
            XCTAssertTrue(AppProtectionPolicy.isProtected(bundlePath: "/Applications/\(name).app/Contents/Helpers/Worker.app"), name)
        }
        XCTAssertFalse(AppProtectionPolicy.isProtected(bundlePath: "/Applications/Discord.app"))
        XCTAssertTrue(AppProtectionPolicy.isProtected(bundlePath: "/System/Applications/Finder.app"))
        XCTAssertTrue(AppProtectionPolicy.isProtected(bundlePath: "relative/Discord.app"))
    }

    func testGroupingUsesOutermostAppAndIgnoresCommands() {
        XCTAssertEqual(
            ProcessGrouping.bundlePath(executablePath: "/Applications/Google Chrome.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper"),
            "/Applications/Google Chrome.app"
        )
        XCTAssertEqual(
            ProcessGrouping.bundlePath(executablePath: "/Users/person/Applications/Example.app/Contents/MacOS/Example"),
            "/Users/person/Applications/Example.app"
        )
        XCTAssertNil(ProcessGrouping.bundlePath(executablePath: "/usr/bin/node"))
        XCTAssertNil(ProcessGrouping.bundlePath(executablePath: "not/an/absolute.app/path"))
    }

    func testMemoryPressureUsesExportedDispatchValuesRatherThanKernelEnum() {
        XCTAssertEqual(MemoryPressure.label(dispatchValue: 1), "normal")
        XCTAssertEqual(MemoryPressure.label(dispatchValue: 2), "warning")
        XCTAssertEqual(MemoryPressure.label(dispatchValue: 4), "critical")
        XCTAssertEqual(MemoryPressure.label(dispatchValue: 0), "unknown")
        XCTAssertEqual(MemoryPressure.label(dispatchValue: 3), "unknown")
        XCTAssertEqual(MemoryPressure.label(dispatchValue: 999), "unknown")
    }

    func testNativeFrameUsesLittleEndianLengthAndExactPayload() throws {
        let payload = Data(repeating: 65, count: 258)
        let frame = try NativeMessageFraming.encode(payload)
        XCTAssertEqual(Array(frame.prefix(4)), [2, 1, 0, 0])
        XCTAssertEqual(Data(frame.dropFirst(4)), payload)
        XCTAssertEqual(try NativeMessageFraming.decodeLength(Data(frame.prefix(4))), 258)
    }

    func testNativeFrameRejectsMalformedAndOversizedLengthsBeforeAllocation() throws {
        for header in [Data(), Data([1, 0, 0]), Data([1, 0, 0, 0, 0]), Data([0, 0, 0, 0]), Data([1, 0, 1, 0]), Data([255, 255, 255, 255])] {
            XCTAssertThrowsError(try NativeMessageFraming.decodeLength(header))
        }
        XCTAssertEqual(try NativeMessageFraming.decodeLength(Data([0, 0, 1, 0])), 65_536)
        XCTAssertThrowsError(try NativeMessageFraming.encode(Data()))
        XCTAssertThrowsError(try NativeMessageFraming.encode(Data(repeating: 0, count: 1_048_577)))
    }

    func testNativeRequestAcceptsOnlyReadOnlySnapshot() throws {
        let request = try NativeRequest.decode(Data(#"{"version":1,"action":"snapshot"}"#.utf8))
        XCTAssertEqual(request.version, 1)
        XCTAssertEqual(request.action, "snapshot")
    }

    func testNativeRequestRejectsWrongTypesCommandsAndAdditionalInput() {
        let rejected = [
            #"{"version":1,"action":"terminate"}"#,
            #"{"version":1,"action":"snapshot","pid":123}"#,
            #"{"version":true,"action":"snapshot"}"#,
            #"{"version":"1","action":"snapshot"}"#,
            #"{"version":1.5,"action":"snapshot"}"#,
            #"{"version":2,"action":"snapshot"}"#,
            #"{"version":1,"action":null}"#,
            #"{"action":"snapshot"}"#,
            "[]", "null", "invalid"
        ]
        for value in rejected {
            XCTAssertThrowsError(try NativeRequest.decode(Data(value.utf8)), value)
        }
        XCTAssertThrowsError(try NativeRequest.decode(Data(repeating: 32, count: 65_537)))
    }
}
