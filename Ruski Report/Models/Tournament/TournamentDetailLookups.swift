//
//  TournamentDetailLookups.swift
//  Ruski Report
//

nonisolated extension TournamentDetail {
    var teamsById: [TournamentTeam.ID: TournamentTeam] {
        Dictionary(uniqueKeysWithValues: teams.map { ($0.id, $0) })
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
}
