// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MemoryHarbor",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "MemoryCore", targets: ["MemoryCore"]),
        .executable(name: "MemoryHarbor", targets: ["MemoryHarbor"])
    ],
    targets: [
        .target(name: "CMemoryProbe", publicHeadersPath: "include"),
        .target(name: "MemoryCore", dependencies: ["CMemoryProbe"]),
        .executableTarget(name: "MemoryHarbor", dependencies: ["MemoryCore"]),
        .testTarget(name: "MemoryCoreTests", dependencies: ["MemoryCore"])
    ]
)
