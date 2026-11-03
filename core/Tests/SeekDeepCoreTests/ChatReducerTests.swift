import XCTest
@testable import SeekDeepCore

final class ChatReducerTests: XCTestCase {
    private func sample(id: String, kind: MessageKind = .system, content: String = "text") -> ChatMessage {
        ChatMessage(id: id, kind: kind, content: content)
    }

    func testResponseChunksAccumulateIntoOneAssistantMessage() {
        var state = ChatState()
        state = ChatReducer.reduce(state, .response(requestId: "r1", chunk: "Hel", done: false, error: nil))
        state = ChatReducer.reduce(state, .response(requestId: "r1", chunk: "lo", done: true, error: nil))

        XCTAssertEqual(state.messages.count, 1)
        XCTAssertEqual(state.messages[0].kind, .assistant)
        XCTAssertEqual(state.messages[0].rawContent, "Hello")
        XCTAssertTrue(state.messages[0].isComplete)
    }

    func testTerminalFrameCompletesTheBubbleEvenAfterAnError() {
        var state = ChatState()
        state = ChatReducer.reduce(state, .response(requestId: "r1", chunk: "partial", done: false, error: nil))
        state = ChatReducer.reduce(state, .response(requestId: "r1", chunk: "", done: true, error: "boom"))

        let assistant = state.messages.first { $0.kind == .assistant }
        XCTAssertEqual(assistant?.isComplete, true, "an error frame must stop the spinner")
        XCTAssertTrue(state.messages.contains { $0.kind == .system && $0.content.contains("boom") })
    }

    func testMessagesCapAt100DroppingOldest() {
        var state = ChatState()
        for index in 0..<105 {
            state = ChatReducer.reduce(state, .message(ChatMessage(id: "m\(index)", kind: .system, content: "x")))
        }
        XCTAssertEqual(state.messages.count, 100)
        XCTAssertEqual(state.messages.first?.id, "m5")
        XCTAssertEqual(state.messages.last?.id, "m104")
    }

    func testDuplicateIdsAreIgnored() {
        var state = ChatState()
        state = ChatReducer.reduce(state, .message(ChatMessage(id: "m1", kind: .system, content: "a")))
        state = ChatReducer.reduce(state, .message(ChatMessage(id: "m1", kind: .system, content: "b")))
        XCTAssertEqual(state.messages.count, 1)
    }

    func testStatusUpdatesRoomFacts() {
        var state = ChatState()
        state = ChatReducer.reduce(state, .status(topic: "abc", role: "host", connected: true, peerCount: 3, collaborative: true, provider: "ollama"))
        XCTAssertEqual(state.topic, "abc")
        XCTAssertEqual(state.role, "host")
        XCTAssertTrue(state.connected)
        XCTAssertEqual(state.peerCount, 3)
        XCTAssertTrue(state.collaborative)
        XCTAssertEqual(state.provider, "ollama")
    }

    func testPeersEventReplacesTheListAndTheCount() {
        var state = ChatState()
        state = ChatReducer.reduce(state, .peers([
            WirePeer(id: "a", displayName: "Ada", role: "host"),
            WirePeer(id: "b", displayName: "Bob", role: "peer")
        ]))
        XCTAssertEqual(state.peers.count, 2)
        XCTAssertEqual(state.peerCount, 2)
    }

    func testModelsEventSelectsFirstModelAndKeepsAValidSelection() {
        var state = ChatState()
        let models = [WireModel(id: "m1", name: "One"), WireModel(id: "m2", name: "Two")]
        state = ChatReducer.reduce(state, .models(provider: "ollama", models: models))
        XCTAssertEqual(state.selectedModel, "m1")

        state.selectedModel = "m2"
        state = ChatReducer.reduce(state, .models(provider: "ollama", models: models))
        XCTAssertEqual(state.selectedModel, "m2", "a still-valid selection must survive a refresh")

        state = ChatReducer.reduce(state, .models(provider: "ollama", models: [WireModel(id: "m3", name: "Three")]))
        XCTAssertEqual(state.selectedModel, "m3", "a vanished selection falls back to the first model")
    }

    func testSlashOutputIsEphemeralAndNotInTranscript() {
        var state = ChatState()
        state = ChatReducer.reduce(state, .slash(content: "/p2p help", kind: "slash-help"))
        XCTAssertEqual(state.ephemeral?.content, "/p2p help")
        XCTAssertEqual(state.ephemeral?.kind, "slash-help")
        XCTAssertEqual(state.messages.count, 0)
    }

    func testErrorBannersDoNotExpireButHelpBannersDo() {
        var state = ChatState()
        state = ChatReducer.reduce(state, .slash(content: "boom", kind: "slash-error"))
        XCTAssertFalse(ChatReducer.shouldExpire(state.ephemeral, now: Date().addingTimeInterval(3600)))

        state = ChatReducer.reduce(state, .slash(content: "help", kind: "slash-help"))
        XCTAssertFalse(ChatReducer.shouldExpire(state.ephemeral, now: Date()))
        XCTAssertTrue(ChatReducer.shouldExpire(state.ephemeral, now: Date().addingTimeInterval(7)))
    }

    func testBotMessageBecomesASystemStyleRow() {
        var state = ChatState()
        state = ChatReducer.reduce(state, .bot(kind: "message", text: "hi", from: "peerA"))
        XCTAssertEqual(state.messages.count, 1)
        XCTAssertEqual(state.messages[0].kind, .bot)
        XCTAssertEqual(state.messages[0].content, "Bot peerA: hi")
    }

    func testOnlyHostMayChangeProviderAndMode() {
        var state = ChatState()
        state = ChatReducer.reduce(state, .status(topic: "t", role: "peer", connected: true, peerCount: 1, collaborative: false, provider: "ollama"))
        XCTAssertFalse(state.isHost)
        state = ChatReducer.reduce(state, .status(topic: "t", role: "host", connected: true, peerCount: 1, collaborative: false, provider: "ollama"))
        XCTAssertTrue(state.isHost)
    }

    func testEmptyReasonIsDerived() {
        var state = ChatState()
        XCTAssertEqual(state.emptyReason, .noProvider)

        state = ChatReducer.reduce(state, .models(provider: "ollama", models: [WireModel(id: "m1", name: "One")]))
        XCTAssertNil(state.emptyReason, "host with a model is ready")

        state = ChatReducer.reduce(state, .status(topic: "t", role: "peer", connected: false, peerCount: 0, collaborative: false, provider: "ollama"))
        XCTAssertEqual(state.emptyReason, .noHost)
    }

    func testThinkingIsExtractedWhileStreaming() {
        let open = "<" + "think>"
        let close = "<" + "/think>"
        var state = ChatState()
        state = ChatReducer.reduce(state, .response(requestId: "r1", chunk: "a" + open + "why", done: false, error: nil))
        XCTAssertEqual(state.thinking, "why")

        state = ChatReducer.reduce(state, .response(requestId: "r1", chunk: close + "b", done: true, error: nil))
        XCTAssertEqual(state.thinking, "why")
        XCTAssertEqual(state.messages[0].rawContent, "a" + open + "why" + close + "b")
    }

    func testHistoryOverlayLeavesTheLiveTranscriptUntouched() {
        var state = ChatState()
        state = ChatReducer.reduce(state, .message(ChatMessage(id: "live-1", kind: .user, content: "hi")))

        state.history = HistoryView(
            id: "old-session",
            name: "old-session",
            messages: [ChatMessage(id: "h-1", kind: .user, content: "past")]
        )

        XCTAssertEqual(state.displayMessages.map(\.id), ["h-1"], "history renders when open")
        XCTAssertEqual(state.messages.map(\.id), ["live-1"], "the room transcript is never replaced")

        state.history = nil
        XCTAssertEqual(state.displayMessages.map(\.id), ["live-1"], "closing history returns to the room")
    }
}
