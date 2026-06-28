//
//  PreviewData.swift
//  Ruski Report
//

import Foundation

nonisolated enum PreviewData {
    static let tournamentPreview = TournamentPreview(
        id: "tournament-2026",
        year: 2026,
        name: "2026 Ruski Tournament",
        status: .scheduled,
        formatSummary: "Pod play and championship bracket",
        locationName: "Durham Ruski Club",
        featuredMatchCount: 1
    )

    static let gameDefinition = GameDefinition(
        gameType: "ruski",
        displayName: "Ruski",
        scorecardDefinitionId: "ruski-scorecard",
        phases: [
            GamePhaseDefinition(id: "guy2guy", label: "Guy2Guy", sequence: 1),
            GamePhaseDefinition(id: "normal", label: "Normal Play", sequence: 2),
            GamePhaseDefinition(id: "redemption", label: "Redemption", sequence: 3),
            GamePhaseDefinition(id: "overtime", label: "Overtime", sequence: 4)
        ],
        eventTypes: [
            GameEventTypeDefinition(
                id: "miss",
                label: "Miss",
                category: "attempt",
                affectsScore: false,
                countsAsAttempt: true,
                statKey: "misses"
            ),
            GameEventTypeDefinition(
                id: "make",
                label: "Make",
                category: "score",
                affectsScore: true,
                countsAsAttempt: true,
                statKey: "makes"
            ),
            GameEventTypeDefinition(
                id: "splashOut",
                label: "Splash-Out",
                category: "attempt",
                affectsScore: false,
                countsAsAttempt: true,
                statKey: "splashOuts"
            ),
            GameEventTypeDefinition(
                id: "guy",
                label: "Guy",
                category: "attempt",
                affectsScore: false,
                countsAsAttempt: true,
                statKey: "guys"
            ),
            GameEventTypeDefinition(
                id: "tri",
                label: "Tri",
                category: "attempt",
                affectsScore: false,
                countsAsAttempt: true,
                statKey: "tris"
            ),
            GameEventTypeDefinition(
                id: "di",
                label: "Di",
                category: "attempt",
                affectsScore: false,
                countsAsAttempt: true,
                statKey: "dis"
            ),
            GameEventTypeDefinition(
                id: "vom",
                label: "Vom",
                category: "penalty",
                affectsScore: false,
                countsAsAttempt: false,
                statKey: "voms"
            )
        ],
        stats: [
            GameStatDefinition(
                key: "makes",
                label: "Cups Made",
                scope: "player",
                valueType: "count"
            ),
            GameStatDefinition(
                key: "misses",
                label: "Cups Missed",
                scope: "player",
                valueType: "count"
            ),
            GameStatDefinition(
                key: "shootingPercentage",
                label: "Shooting Percentage",
                scope: "player",
                valueType: "percentage"
            ),
            GameStatDefinition(
                key: "splashOuts",
                label: "Splash-Out",
                scope: "player",
                valueType: "count"
            ),
            GameStatDefinition(
                key: "guys",
                label: "Guy",
                scope: "player",
                valueType: "count"
            ),
            GameStatDefinition(
                key: "tris",
                label: "Tri",
                scope: "player",
                valueType: "count"
            ),
            GameStatDefinition(
                key: "dis",
                label: "Di",
                scope: "player",
                valueType: "count"
            ),
            GameStatDefinition(
                key: "voms",
                label: "Vom",
                scope: "player",
                valueType: "count"
            )
        ]
    )

    static let tournamentDetail = TournamentDetail(
        id: tournamentPreview.id,
        preview: tournamentPreview,
        pods: [
            TournamentPod(
                id: "pod-a",
                name: "Pod A",
                sequence: 1,
                teamIds: teams.map(\.id),
                matchIds: [openingMatch.id, secondMatch.id]
            )
        ],
        teams: teams,
        standings: standings,
        bracket: TournamentBracket(
            id: "bracket-2026",
            rounds: [
                BracketRound(
                    id: "round-1",
                    name: "Semifinals",
                    sequence: 1,
                    matchIds: [openingMatch.id, secondMatch.id]
                )
            ]
        ),
        matches: [openingMatch, secondMatch]
    )
}
