//
//  PublicDTOTests.swift
//  Ruski ReportTests
//

import Foundation
import Testing
@testable import Ruski_Report

struct PublicDTOTests {
    @Test func decodesEmptyCanonicalDiscoveryEnvelope() throws {
        let data = Data(#"{"contractVersion":2,"tournaments":[]}"#.utf8)
        let envelope = try JSONDecoder().decode(
            PublicTournamentDiscoveryEnvelopeDTO.self,
            from: data
        )

        #expect(envelope.contractVersion == 2)
        #expect(envelope.tournaments.isEmpty)
    }

    @Test func decodesNullableCanonicalScoreValuesWithoutZeroFilling() throws {
        let data = Data(#"""
        {
          "columns": [{
            "key": "shootingPercentage",
            "label": "Shooting %",
            "format": "percentage"
          }],
          "rows": [{
            "id": "row-1",
            "subject": {
              "id": "player-1",
              "displayName": "Player One",
              "type": "player"
            },
            "teamId": "team-1",
            "values": {"shootingPercentage": null}
          }],
          "totals": {"shootingPercentage": null}
        }
        """#.utf8)
        let boxScore = try JSONDecoder().decode(PublicBoxScoreDTO.self, from: data)

        #expect(boxScore.rows.first?.values.keys.contains("shootingPercentage") == true)
        #expect(boxScore.rows.first?.values["shootingPercentage"] == nil)
        #expect(boxScore.totals.keys.contains("shootingPercentage"))
    }

    @Test func missingRequiredProjectionFieldFailsDecoding() {
        let data = Data(#"{"tournamentId":"tournament-1","version":4,"source":"canonical"}"#.utf8)

        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(PublicProjectionDTO.self, from: data)
        }
    }
}
