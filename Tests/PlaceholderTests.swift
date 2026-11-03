import XCTest
@testable import SeekDeepCore

/// Smoke test for the Xcode test target: the package is linked and importable from the
/// app project. The real coverage lives in `core/Tests` and runs with `swift test`.
final class PlaceholderTests: XCTestCase {
    func testPackageLoads() {
        XCTAssertEqual(JSONValue.string("ok").string, "ok")
    }
}
