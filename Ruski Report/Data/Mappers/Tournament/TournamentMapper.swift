//
//  TournamentMapper.swift
//  Ruski Report
//

import Foundation

nonisolated enum TournamentMapper {
    static func preview(from dto: TournamentSummaryDTO) -> TournamentPreview {
        TournamentPreview(
            id: dto.id,
            year: dto.year,
            name: dto.name,
            status: mapStatus(dto.status),
            formatSummary: formatSummary(dto.format),
            locationName: locationName(from: dto.metadata),
            featuredMatchCount: dto.featuredMatchIds.count
        )
    }

    static func preview(from dto: TournamentDTO) -> TournamentPreview {
        TournamentPreview(
            id: dto.id,
            year: dto.year,
            name: dto.name,
            status: mapStatus(dto.status),
            formatSummary: formatSummary(dto.format),
            locationName: locationName(from: dto.metadata),
            featuredMatchCount: dto.featuredMatchIds.count
        )
    }

    static func detail(from dto: TournamentDTO) -> TournamentDetail {
        let preview = preview(from: dto)

        return TournamentDetail(
            id: dto.id,
            preview: preview,
            pods: dto.pods.map(mapPod),
            teams: dto.teams.map(mapTeam),
            standings: dto.standings.map(mapStanding),
            bracket: dto.bracket.map(mapBracket),
            matches: dto.matchSummaries.map(MatchMapper.preview)
        )
    }

    static func mapStatus(_ value: String) -> TournamentPreviewStatus {
        switch value {
        case "scheduled":
            .scheduled
        case "active":
            .active
        case "completed":
            .completed
        case "archived":
            .archived
        default:
            .unknown(value)
        }
    }

    private static func formatSummary(
        _ format: TournamentFormatDTO
    ) -> String {
        if let description = format.description, !description.isEmpty {
            return description
        }

        return format.type
            .split(separator: "_")
            .map { $0.capitalized }
            .joined(separator: " ")
    }

    private static func locationName(
        from metadata: [String: JSONValue]?
    ) -> String {
        metadata?["locationName"]?.stringValue ?? "Durham Ruski Club"
    }

    private static func mapPod(_ dto: TournamentPodDTO) -> TournamentPod {
        TournamentPod(
            id: dto.id,
            name: dto.name,
            sequence: dto.sequence,
            teamIds: dto.teamIds,
            matchIds: dto.matchIds ?? []
        )
    }

    private static func mapTeam(_ dto: TournamentTeamDTO) -> TournamentTeam {
        TournamentTeam(
            id: dto.id,
            name: dto.name,
            seed: dto.seed?.overall ?? dto.seed?.pod,
            players: dto.players.map {
                TournamentPlayer(id: $0.id, displayName: $0.displayName)
            }
        )
    }

    private static func mapStanding(_ dto: StandingDTO) -> PodStanding {
        PodStanding(
            id: dto.id,
            podId: dto.podId,
            teamId: dto.teamId,
            rank: dto.rank,
            wins: dto.record.wins,
            losses: dto.record.losses,
            points: dto.points,
            cupDifferential: dto.metricValues?["cupDifferential"]?.doubleValue,
            shootingPercentage: dto.metricValues?["shootingPercentage"]?.doubleValue
        )
    }

    private static func mapBracket(_ dto: BracketDTO) -> TournamentBracket {
        TournamentBracket(
            id: dto.id,
            rounds: dto.rounds.map {
                BracketRound(
                    id: $0.id,
                    name: $0.name,
                    sequence: $0.sequence,
                    matchIds: bracketMatchIds(from: $0)
                )
            }
        )
    }

    private static func bracketMatchIds(from dto: BracketRoundDTO) -> [String] {
        if let matchIds = dto.matchIds {
            return matchIds
        }

        return dto.matches?.compactMap(\.matchId) ?? []
    }
}
