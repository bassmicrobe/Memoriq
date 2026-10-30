import XCTest
@testable import MemoryCore

final class RestSessionTests: XCTestCase {
    private func app(_ name: String = "Discord", protected: Bool = false) -> AppMemory {
        let path = "/Applications/\(name).app"
        return AppMemory(id: path, name: name, bundlePath: path, footprintBytes: 512,
                         processCount: 2, protected: protected)
    }

    func testOnlyConfirmedTerminatedAppsAreRecordedWithoutChangingOriginalSession() throws {
        let initial = RestSession()
        XCTAssertThrowsError(try initial.recording(app(), runningBundlePaths: [app().bundlePath]))
        XCTAssertTrue(initial.apps.isEmpty)
        let ended = try initial.recording(app(), runningBundlePaths: [])
        XCTAssertEqual(ended.apps, [app()])
        XCTAssertTrue(initial.apps.isEmpty)
        XCTAssertEqual(try ended.recording(app(), runningBundlePaths: []).apps.count, 1)
    }

    func testProtectedAndInvalidAppsCannotBeRecorded() {
        let session = RestSession()
        for value in [app("Cursor"), app("ChatGPT"), app("Docker"), app(protected: true), AppMemory(id: "x", name: "x", bundlePath: "relative.app", footprintBytes: 0, processCount: 0, protected: false)] {
            XCTAssertThrowsError(try session.recording(value, runningBundlePaths: []))
        }
        XCTAssertTrue(session.apps.isEmpty)
    }

    func testReopenedAndExternallyStartedAppsLeaveTheRestList() throws {
        let session = try RestSession().recording(app(), runningBundlePaths: [])
        XCTAssertTrue(session.removing(bundlePath: app().bundlePath).apps.isEmpty)
        XCTAssertTrue(session.reconciled(runningBundlePaths: [app().bundlePath]).apps.isEmpty)
        XCTAssertEqual(session.reconciled(runningBundlePaths: []).apps, [app()])
    }
}
