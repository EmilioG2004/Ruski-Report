//
//  TournamentDetailLookups.swift
//  Ruski Report
//

nonisolated extension TournamentDetail {
    var teamsById: [TournamentTeam.ID: TournamentTeam] {
        Dictionary(uniqueKeysWithValues: teams.map { ($0.id, $0) })
    }

    var standingsByTeamId: [TournamentTeam.ID: PodStanding] {
        Dictionary(uniqueKeysWithValues: standings.map { ($0.teamId, $0) })
    }

    var matchesById: [MatchPreview.ID: MatchPreview] {
        Dictionary(uniqueKeysWithValues: matches.map { ($0.id, $0) })
    }

    func teamName(for teamId: TournamentTeam.ID) -> String {
        teamsById[teamId]?.name ?? teamId
    }

    func participantsLabel(for match: MatchPreview) -> String {
        let names = match.participants.map { participant in
            teamName(for: participant.teamId)
        }

        guard !names.isEmpty else {
            return "Teams TBD"
        }

        return names.joined(separator: " vs ")
    }

    func scoreLabel(for match: MatchPreview) -> String? {
        guard let score = match.score, !score.participants.isEmpty else {
            return nil
        }

        return score.participants
            .map { "\(teamName(for: $0.teamId)) \($0.score)" }
            .joined(separator: " - ")
    }

    func podStandingRows(for pod: TournamentPod) -> [TournamentPodStandingRow] {
        let originalOrder = Dictionary(
            uniqueKeysWithValues: pod.teamIds.enumerated().map { index, teamId in
                (teamId, index)
            }
        )

        return pod.teamIds
            .map { teamId in
                let team = teamsById[teamId]
                let standing = standingsByTeamId[teamId]

                return TournamentPodStandingRow(
                    teamId: teamId,
                    teamName: team?.name ?? teamId,
                    seed: team?.seed,
                    rank: standing?.rank,
                    wins: standing?.wins,
                    losses: standing?.losses,
                    cupDifferential: standing?.cupDifferential,
                    shootingPercentage: standing?.shootingPercentage
                )
            }
            .sorted { lhs, rhs in
                if lhs.rank != rhs.rank {
                    switch (lhs.rank, rhs.rank) {
                    case let (lhsRank?, rhsRank?):
                        return lhsRank < rhsRank
                    case (_?, nil):
                        return true
                    case (nil, _?):
                        return false
                    case (nil, nil):
                        break
                    }
                }

                if let lhsSeed = lhs.seed,
                   let rhsSeed = rhs.seed,
                   lhsSeed != rhsSeed {
                    return lhsSeed < rhsSeed
                }

                return (originalOrder[lhs.teamId] ?? Int.max) <
                    (originalOrder[rhs.teamId] ?? Int.max)
            }
    }
}

nonisolated struct TournamentPodStandingRow: Identifiable, Equatable {
    var id: String { teamId }

    let teamId: String
    let teamName: String
    let seed: Int?
    let rank: Int?
    let wins: Int?
    let losses: Int?
    let cupDifferential: Double?
    let shootingPercentage: Double?
}
