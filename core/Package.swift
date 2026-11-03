// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SeekDeepCore",
    platforms: [.macOS(.v14)],
    products: [.library(name: "SeekDeepCore", targets: ["SeekDeepCore"])],
    targets: [
        .target(name: "SeekDeepCore"),
        .testTarget(name: "SeekDeepCoreTests", dependencies: ["SeekDeepCore"])
    ],
    // Swift 5 language mode on purpose: this package is a straight port of JavaScript
    // semantics, and Swift 6 strict concurrency would force `Sendable` noise on every
    // value type without changing a single behaviour.
    swiftLanguageModes: [.v5]
)
