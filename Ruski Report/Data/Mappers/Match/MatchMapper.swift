//
//  MatchMapper.swift
//  Ruski Report
//

import Foundation

nonisolated enum MatchMapper {
    static func preview(_ dto: MatchSummaryDTO) -> MatchPreview {
        MatchPreview(
            id: dto.id,
            tournamentId: dto.tournamentId,
            gameType: dto.gameType,
            status: mapStatus(dto.status),
            participants: dto.participants.map(mapParticipant),
            score: dto.score.map(mapScore),
            podId: dto.podId,
            currentPhaseLabel: dto.currentPhase?.label,
            updatedAt: dto.updatedAt
        )
    }

    static func detail(_ dto: MatchDetailDTO) -> MatchDetail {
        let preview = MatchPreview(
            id: dto.id,
            tournamentId: dto.tournamentId,
            gameType: dto.gameType,
            status: mapStatus(dto.status),
            participants: dto.participants.map(mapParticipant),
            score: dto.score.map(mapScore),
            podId: dto.podId,
            currentPhaseLabel: dto.currentPhase?.label,
            updatedAt: dto.updatedAt
        )

        return MatchDetail(
            id: dto.id,
            preview: preview,
            boxScore: dto.boxScore.map(mapBoxScore),
            scorecard: dto.scorecard.map(mapScorecard),
            events: dto.events.map(mapEvent),
            commentsSummary: dto.commentsSummary.map(mapCommentsSummary)
        )
    }

    private static func mapStatus(_ value: String) -> MatchStatus {
        switch value {
        case "scheduled":
            .scheduled
        case "in_progress":
            .inProgress
        case "final":
            .final
        default:
            .unknown(value)
        }
    }

    private static func mapParticipant(
        _ dto: MatchParticipantDTO
    ) -> MatchParticipant {
        MatchParticipant(
            teamId: dto.teamId,
            role: dto.role,
            seed: dto.seed,
            playerIds: dto.playerIds ?? [],
            score: dto.score,
            result: dto.result
        )
    }

    private static func mapScore(_ dto: MatchScoreDTO) -> MatchScore {
        MatchScore(
            participants: dto.participants.map {
                TeamScore(teamId: $0.teamId, score: $0.score)
            },
            winnerTeamId: dto.winnerTeamId,
            isFinal: dto.isFinal
        )
    }

    private static func mapBoxScore(_ dto: BoxScoreDTO) -> BoxScore {
        BoxScore(
            matchId: dto.matchId,
            rows: dto.rows.map(mapBoxScoreRow),
            totals: doubleDictionary(dto.totals ?? [:])
        )
    }

    private static func mapBoxScoreRow(_ dto: BoxScoreRowDTO) -> BoxScoreRow {
        BoxScoreRow(
            id: dto.subject.playerId ?? dto.subject.teamId ?? dto.subject.label,
            label: dto.subject.label,
            stats: doubleDictionary(dto.stats)
        )
    }

    private static func mapScorecard(_ dto: ScorecardDTO) -> Scorecard {
        Scorecard(
            columns: dto.definition.columns.map {
                ScorecardColumn(
                    key: $0.key,
                    label: $0.label,
                    dataType: $0.dataType
                )
            },
            rows: dto.rows.map(mapScorecardRow)
        )
    }

    private static func mapScorecardRow(_ dto: ScorecardRowDTO) -> ScorecardRow {
        ScorecardRow(
            id: dto.id,
            sequence: dto.sequence,
            values: dto.values.mapValues { $0.stringValue ?? "" }
        )
    }

    private static func mapEvent(_ dto: GameEventDTO) -> GameEvent {
        GameEvent(
            id: dto.id,
            type: dto.type,
            sequence: dto.sequence,
            teamId: dto.teamId,
            playerId: dto.playerId,
            value: dto.value
        )
    }

    private static func mapCommentsSummary(
        _ dto: CommentsSummaryDTO
    ) -> MatchCommentsSummary {
        MatchCommentsSummary(
            matchId: dto.matchId,
            count: dto.count,
            latestCommentAt: dto.latestCommentAt
        )
    }

    private static func doubleDictionary(
        _ values: [String: JSONValue]
    ) -> [String: Double] {
        values.reduce(into: [:]) { result, entry in
            if let value = entry.value.doubleValue {
                result[entry.key] = value
            }
        }
    }
}
