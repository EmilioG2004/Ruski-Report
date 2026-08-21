//
//  MatchTurnProjector.swift
//  Ruski Report
//
//  Converts normalized scorecard rows and events into stable turn groups.
//  Scorecard rows lead the projection; unlinked events remain visible through
//  a conservative fallback for older or partially recorded API payloads.
//

import Foundation

nonisolated enum MatchTurnProjector {
    static func project(
        scorecard: Scorecard?,
        events: [GameEvent]
    ) -> [MatchTurn] {
        let eventsById = Dictionary(uniqueKeysWithValues: events.map { ($0.id, $0) })
        let rowShots = (scorecard?.rows ?? []).map { row in
            shot(from: row, eventsById: eventsById)
        }
        let linkedEventIds = Set((scorecard?.rows ?? []).flatMap(\.eventIds))
        let unlinkedShots = events
            .filter { !linkedEventIds.contains($0.id) }
            .map(shot(from:))

        return makeTurns(from: rowShots + unlinkedShots)
    }

    private static func shot(
        from row: ScorecardRow,
        eventsById: [String: GameEvent]
    ) -> ProjectedShot {
        let events = row.eventIds
            .compactMap { eventsById[$0] }
            .sorted { $0.sequence < $1.sequence }

        return ProjectedShot(
            turnNumber: turnNumber(for: row),
            teamTurnOrder: row.teamTurnOrder ?? 1,
            shot: MatchTurnShot(
                id: row.id,
                sequence: row.sequence,
                position: row.shotInTeamTurn ?? 1,
                teamId: row.teamId,
                playerId: row.playerId ?? events.first?.playerId,
                scorecardRow: row,
                events: events
            )
        )
    }

    private static func shot(from event: GameEvent) -> ProjectedShot {
        ProjectedShot(
            turnNumber: event.turnNumber ?? event.sequence,
            teamTurnOrder: event.teamTurnOrder ?? 1,
            shot: MatchTurnShot(
                id: "event-shot-\(event.id)",
                sequence: event.sequence,
                position: event.shotInTeamTurn ?? 1,
                teamId: event.teamId,
                playerId: event.playerId,
                scorecardRow: nil,
                events: [event]
            )
        )
    }

    private static func turnNumber(for row: ScorecardRow) -> Int {
        if let turnNumber = row.turnNumber {
            return turnNumber
        }

        if let rawValue = row.values[MatchScorecardField.shotNumber],
           let value = Double(rawValue),
           let turnNumber = Int(exactly: value) {
            return turnNumber
        }

        return row.sequence
    }

    private static func makeTurns(from shots: [ProjectedShot]) -> [MatchTurn] {
        let grouped = Dictionary(grouping: shots, by: \.turnNumber)

        return grouped.keys.sorted().map { turnNumber in
            MatchTurn(
                number: turnNumber,
                teamTurns: makeTeamTurns(
                    turnNumber: turnNumber,
                    shots: grouped[turnNumber, default: []]
                )
            )
        }
    }

    private static func makeTeamTurns(
        turnNumber: Int,
        shots: [ProjectedShot]
    ) -> [MatchTeamTurn] {
        let grouped = Dictionary(grouping: shots) { shot in
            TeamTurnKey(
                teamId: shot.shot.teamId,
                order: shot.teamTurnOrder
            )
        }

        return grouped.keys.sorted(by: TeamTurnKey.precedes).map { key in
            MatchTeamTurn(
                turnNumber: turnNumber,
                teamId: key.teamId,
                order: key.order,
                shots: grouped[key, default: []]
                    .map(\.shot)
                    .sorted(by: MatchTurnShot.precedes)
            )
        }
    }
}

private nonisolated struct ProjectedShot {
    let turnNumber: Int
    let teamTurnOrder: Int
    let shot: MatchTurnShot
}

private nonisolated struct TeamTurnKey: Hashable {
    let teamId: String?
    let order: Int

    static func precedes(_ first: Self, _ second: Self) -> Bool {
        first.order == second.order
            ? (first.teamId ?? "") < (second.teamId ?? "")
            : first.order < second.order
    }
}

private nonisolated extension MatchTurnShot {
    static func precedes(_ first: Self, _ second: Self) -> Bool {
        first.position == second.position
            ? first.sequence < second.sequence
            : first.position < second.position
    }
}
