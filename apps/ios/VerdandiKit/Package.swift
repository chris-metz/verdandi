// swift-tools-version: 6.2
import PackageDescription

// What the iOS app needs below its interface: the core run on
// JavaScriptCore, GitHub reached with the app's token, and the contract's
// types. It builds for macOS too, so that `swift test` runs it on a Mac.
let package = Package(
    name: "VerdandiKit",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "VerdandiKit", targets: ["VerdandiKit"])
    ],
    targets: [
        .target(name: "VerdandiKit"),
        .testTarget(name: "VerdandiKitTests", dependencies: ["VerdandiKit"]),
    ]
)
