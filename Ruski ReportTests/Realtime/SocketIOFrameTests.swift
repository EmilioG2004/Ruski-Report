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

    @Test func parsesCanonicalProjectionVersionWithoutChangingLegacyVersion() throws {
        let frame = "42/live,[\"live.update\",{" +
            "\"id\":\"live-2\",\"type\":\"match.updated\"," +
            "\"occurredAt\":\"2027-07-12T20:00:00.000Z\"," +
            "\"tournamentId\":\"tournament-public-2027\"," +
            "\"matchId\":\"match-1\",\"version\":41," +
            "\"projectionVersion\":8}]"

        guard case .liveUpdate(let update) = try SocketIOFrame.parse(frame) else {
            Issue.record("Expected a live update.")
            return
        }
        #expect(update.version == 41)
        #expect(update.projectionVersion == 8)
    }

    @Test func comparesStaleNewAndAbsentProjectionVersions() throws {
        let projection = PublicProjectionReference(
            tournamentId: "tournament-public-2027",
            version: 7,
            activatedAt: "2027-07-12T19:00:00.000Z"
        )
        let stale = try parsedUpdate(projectionVersion: 6)
        let current = try parsedUpdate(projectionVersion: 7)
        let newer = try parsedUpdate(projectionVersion: 8)
        let absent = try parsedUpdate(projectionVersion: nil)

        #expect(stale.projectionComparison(to: projection) == .stale)
        #expect(current.projectionComparison(to: projection) == .current)
        #expect(newer.projectionComparison(to: projection) == .newer)
        #expect(absent.projectionComparison(to: projection) == .absent)
        #expect(!stale.shouldRefresh(after: projection))
        #expect(!current.shouldRefresh(after: projection))
        #expect(newer.shouldRefresh(after: projection))
        #expect(absent.shouldRefresh(after: projection))
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

private func parsedUpdate(projectionVersion: Int64?) throws -> RealtimeUpdate {
    let versionField = projectionVersion.map { ",\"projectionVersion\":\($0)" } ?? ""
    let frame = "42/live,[\"live.update\",{" +
        "\"id\":\"live-comparison\",\"type\":\"tournament.updated\"," +
        "\"occurredAt\":\"2027-07-12T20:00:00.000Z\"," +
        "\"tournamentId\":\"tournament-public-2027\"," +
        "\"version\":4\(versionField)}]"
    guard case .liveUpdate(let update) = try SocketIOFrame.parse(frame) else {
        throw AppError.decodingFailed("Expected a live update.")
    }
    return update
}
