// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "Verdandi",
  platforms: [.macOS(.v26)],
  products: [
    .executable(name: "Verdandi", targets: ["Verdandi"])
  ],
  targets: [
    // Everything that does not draw: GitHub through gh, settings, the forest.
    .target(name: "VerdandiCore"),
    // The SwiftUI app. Its code runs on the main actor unless it says not to.
    .executableTarget(
      name: "Verdandi",
      dependencies: ["VerdandiCore"],
      swiftSettings: [.defaultIsolation(MainActor.self)]
    ),
    .testTarget(name: "VerdandiCoreTests", dependencies: ["VerdandiCore"]),
  ]
)
