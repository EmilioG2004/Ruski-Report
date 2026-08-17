//
//  PresentationFormatterTests.swift
//  Ruski ReportTests
//
//  Protects shared presentation policies that keep Home and Tournament feeds
//  consistent as new games and statistics are introduced.
//

import Testing
@testable import Ruski_Report

@MainActor
struct PresentationFormatterTests {
    @Test func matchContextUsesPodNameOrBracketFallback() {
        let detail = PreviewData.tournamentDetail

        #expect(
            TournamentMatchContextFormatter.label(
                for: PreviewData.openingMatch,
                in: detail
            ) == "Pod A"
        )
        #expect(
            TournamentMatchContextFormatter.label(
                for: PreviewData.championshipMatch,
                in: detail
            ) == "Championship bracket"
        )
    }

    @Test func statisticFormatterHandlesMissingPercentageAndDecimalValues() {
        let formatter = DefaultTournamentStatisticValueFormatter()

        #expect(formatter.string(for: nil, type: "number") == "-")
        #expect(formatter.string(for: 4, type: "number") == "4")
        #expect(formatter.string(for: 4.25, type: "number") == "4.25")
        #expect(formatter.string(for: 0.625, type: "percentage") == "62.5%")
    }
}
