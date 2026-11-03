import Foundation

/// `seekdeep://join/<topic>` — the invite URL the native app registers and copies.
///
/// The topic rule is the worker's rule, not a looser one: exactly 64 hex characters
/// (`TOPIC_PATTERN` in `js/p2p/chat-service.js`). A prefix of a topic is not a topic.
public enum InviteLink {
    public static let scheme = "seekdeep"

    /// The path segment the URL is built from. Host and path-only forms both use it.
    private static let host = "join"

    /// Nil unless `topic` is 64 hex characters (either case). The URL always carries the
    /// lowercase form, so a copied invite cannot smuggle mixed-case keys around.
    public static func url(forTopic topic: String) -> URL? {
        guard let normalized = normalizedTopic(topic) else { return nil }
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.path = "/" + normalized
        return components.url
    }

    /// Accepts exactly three shapes, all yielding the lowercase 64-hex topic:
    /// `seekdeep://join/<hex>`, `seekdeep://join/<hex>/`, and `seekdeep://join?topic=<hex>`.
    /// Everything else — wrong scheme, wrong host, 63/65 hex, non-hex, extra path or
    /// query — is nil.
    public static func topic(from url: URL) -> String? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        guard components.scheme?.lowercased() == scheme else { return nil }
        guard components.host?.lowercased() == host else { return nil }
        // A port, user info, or fragment is not one of the three accepted shapes.
        guard components.port == nil, components.user == nil, components.password == nil, components.fragment == nil else { return nil }

        let queryItems = components.queryItems ?? []
        let hex: String?
        if queryItems.isEmpty {
            var path = components.path
            guard path.hasPrefix("/") else { return nil }
            path.removeFirst()
            if path.hasSuffix("/") { path.removeLast() }
            // One path segment only: `join/<hex>` or `join/<hex>/`, never `join/a/<hex>`.
            guard !path.isEmpty, !path.contains("/") else { return nil }
            hex = path
        } else {
            // Query form: the path must be empty (`join?topic=`) or a bare slash
            // (`join/?topic=`), and `topic` must be the only parameter.
            guard components.path.isEmpty || components.path == "/" else { return nil }
            guard queryItems.count == 1, queryItems[0].name == "topic", let value = queryItems[0].value else { return nil }
            hex = value
        }
        return normalizedTopic(hex ?? "")
    }

    /// Same rule as `TOPIC_PATTERN`: `^[0-9a-f]{64}$`, after lowercasing the input.
    private static func normalizedTopic(_ value: String) -> String? {
        let lowered = value.lowercased()
        guard lowered.count == 64 else { return nil }
        guard lowered.allSatisfy({ $0.isASCII && $0.isHexDigit }) else { return nil }
        return lowered
    }
}
