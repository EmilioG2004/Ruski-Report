//
//  SocketIOFrameTests.swift
//  Ruski ReportTests
//

import Foundation
import Testing
@testable import Ruski_Report

struct SocketIOFrameTests {
    @Test func parsesSocketIOConnectionAndPingFrames() throws {
        #expect(try SocketIOFrame.parse("0{\"sid\":\"abc\"}") == .engineOpen)
        #expect(try SocketIOFrame.parse("40/live,{\"sid\":\"def\"}") == .namespaceConnected)
        #expect(try SocketIOFrame.parse("2") == .enginePing)
    }

    @Test func parsesLiveUpdateEventFrames() throws {
        let frame = """
        42/live,["live.update",{"id":"live-1","type":"tournament.updated","occurredAt":"2026-07-12T20:00:00.000Z","tournamentId":"tournament-2026","version":4}]
        """

        #expect(
            try SocketIOFrame.parse(frame) == .liveUpdate(
                RealtimeUpdate(
                    id: "live-1",
                    type: .tournamentUpdated,
                    tournamentId: "tournament-2026",
                    matchId: nil,
                    occurredAt: "2026-07-12T20:00:00.000Z",
                    version: 4,
                    metadata: nil
                )
            )
        )
    }

    @Test func encodesSubscribeFrames() throws {
        let frame = try SocketIOFrame.subscribe(
            subscription: .match(
                tournamentId: "tournament-2026",
                matchId: "match-1"
            )
        )

        #expect(frame.hasPrefix("42/live,"))
        #expect(frame.contains("\"subscribe\""))
        #expect(frame.contains("\"scope\":\"match\""))
        #expect(frame.contains("\"tournamentId\":\"tournament-2026\""))
        #expect(frame.contains("\"matchId\":\"match-1\""))
    }

    @Test func derivesWebSocketURLFromAPIBaseURL() {
        let url = URLSessionSocketIORealtimeUpdateRepository.makeWebSocketURL(
            apiBaseURL: URL(string: "http://127.0.0.1:3000/api")!
        )

        #expect(
            url.absoluteString ==
                "ws://127.0.0.1:3000/socket.io/?EIO=4&transport=websocket"
        )
    }

    @Test func derivesSecureProductionWebSocketURLFromAPIBaseURL() {
        let url = URLSessionSocketIORealtimeUpdateRepository.makeWebSocketURL(
            apiBaseURL: URL(string: "https://api.ruskireport.com/api")!
        )

        #expect(
            url.absoluteString ==
                "wss://api.ruskireport.com/socket.io/?EIO=4&transport=websocket"
        )
    }
}
