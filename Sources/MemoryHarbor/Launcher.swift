import AppKit
import Foundation
import MemoryCore
import SwiftUI

@main
enum Launcher {
    @MainActor static func main() {
        let arguments = Array(CommandLine.arguments.dropFirst())
        if arguments.first == "--native-host" {
            NativeHost.run(origin: arguments.dropFirst().first)
            return
        }
        if arguments.first?.hasPrefix("chrome-extension://") == true {
            NativeHost.run(origin: arguments.first)
            return
        }
        if arguments == ["--snapshot"] {
            NativeHost.printSnapshot()
            return
        }
        guard arguments.isEmpty else {
            FileHandle.standardError.write(Data("Usage: MemoryHarbor [--snapshot]\n".utf8))
            exit(64)
        }
        MemoryHarborApp.main()
    }
}

struct MemoryHarborApp: App {
    @StateObject private var monitor = MemoryMonitor()

    var body: some Scene {
        Window("Memoriq", id: "dashboard") {
            DashboardView(monitor: monitor)
        }
        .windowResizability(.contentSize)
        MenuBarExtra("Memoriq", systemImage: monitor.statusIcon) {
            DashboardView(monitor: monitor)
        }
        .menuBarExtraStyle(.window)
    }
}
