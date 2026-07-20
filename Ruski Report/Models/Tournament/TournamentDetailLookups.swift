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

    func bracketRoundSections() -> [TournamentBracketRoundSection] {
        guard let bracket else {
            return []
        }

        let sortedRounds = bracket.rounds.sorted { $0.sequence < $1.sequence }

        return sortedRounds.map { round in
            let laterRounds = sortedRounds.filter { $0.sequence > round.sequence }
            let bracketMatches = round.matches.isEmpty
                ? round.matchIds.enumerated().map { index, matchId in
                    TournamentBracketMatch(
                        id: matchId,
                        matchId: matchId,
                        sequence: index + 1,
                        status: "pending",
                        slots: [],
                        winnerTeamId: nil
                    )
                }
                : round.matches.sorted { $0.sequence < $1.sequence }

            return TournamentBracketRoundSection(
                id: round.id,
                name: round.name,
                sequence: round.sequence,
                matchups: bracketMatches.enumerated().map { index, bracketMatch in
                    bracketMatchup(
                        bracketMatch: bracketMatch,
                        ordinal: index + 1,
                        laterRounds: laterRounds
                    )
                }
            )
        }
    }

    private func bracketMatchup(
        bracketMatch: TournamentBracketMatch,
        ordinal: Int,
        laterRounds: [BracketRound]
    ) -> TournamentBracketMatchup {
        let match = bracketMatch.matchId.flatMap { matchesById[$0] }
        let winnerTeamId = bracketMatch.winnerTeamId ?? match.flatMap(resolvedWinnerTeamId)
        let slots = bracketSlots(
            bracketMatch: bracketMatch,
            match: match,
            winnerTeamId: winnerTeamId
        )

        return TournamentBracketMatchup(
            id: bracketMatch.id,
            matchId: match?.id,
            title: matchupTitle(slots: slots, ordinal: ordinal),
            statusText: match?.status.displayName ?? statusLabel(bracketMatch.status),
            slots: slots,
            progressionText: progressionText(
                bracketMatchId: bracketMatch.id,
                winnerTeamId: winnerTeamId,
                laterRounds: laterRounds
            ),
            isAvailable: match != nil
        )
    }

    private func bracketSlots(
        bracketMatch: TournamentBracketMatch,
        match: MatchPreview?,
        winnerTeamId: String?
    ) -> [TournamentBracketTeamSlot] {
        if !bracketMatch.slots.isEmpty {
            return bracketMatch.slots.enumerated().map { index, slot in
                let participant = match?.participants.first {
                    $0.teamId == slot.teamId
                }

                return TournamentBracketTeamSlot(
                    id: "\(bracketMatch.id)-slot-\(index + 1)",
                    teamId: slot.teamId,
                    teamName: slot.teamId.map(teamName) ?? slot.source?.label ?? "TBD",
                    seed: slot.seed ?? participant?.seed ?? slot.teamId.flatMap {
                        teamsById[$0]?.seed
                    },
                    score: participant.flatMap { participant in
                        match.flatMap { score(for: participant, in: $0) }
                    },
                    isWinner: slot.teamId != nil && winnerTeamId == slot.teamId
                )
            }
        }

        return (match?.participants ?? []).enumerated().map { index, participant in
            TournamentBracketTeamSlot(
                id: "\(bracketMatch.id)-slot-\(index + 1)",
                teamId: participant.teamId,
                teamName: teamName(for: participant.teamId),
                seed: participant.seed ?? teamsById[participant.teamId]?.seed,
                score: match.flatMap { score(for: participant, in: $0) },
                isWinner: winnerTeamId == participant.teamId
            )
        }
    }

    private func matchupTitle(
        slots: [TournamentBracketTeamSlot],
        ordinal: Int
    ) -> String {
        let teamNames = slots.map(\.teamName).filter { $0 != "TBD" }
        return teamNames.isEmpty ? "Match \(ordinal)" : teamNames.joined(separator: " vs ")
    }

    private func statusLabel(_ status: String) -> String {
        MatchDetailScreen.readableLabel(from: status)
    }

    private func resolvedWinnerTeamId(for match: MatchPreview) -> String? {
        if let winnerTeamId = match.score?.winnerTeamId {
            return winnerTeamId
        }

        return match.participants.first { $0.result == "win" }?.teamId
    }

    private func score(
        for participant: MatchParticipant,
        in match: MatchPreview
    ) -> Int? {
        participant.score ??
            match.score?.participants.first { $0.teamId == participant.teamId }?.score
    }

    private func progressionText(
        bracketMatchId: String,
        winnerTeamId: TournamentTeam.ID?,
        laterRounds: [BracketRound]
    ) -> String? {
        guard let nextRound = nextRound(
            for: bracketMatchId,
            in: laterRounds
        ) else {
            return winnerTeamId == nil ? nil : "Bracket winner"
        }

        return "Winner advances to \(nextRound.name)"
    }

    private func nextRound(
        for bracketMatchId: String,
        in laterRounds: [BracketRound]
    ) -> BracketRound? {
        return laterRounds.first { round in
            round.matches.contains { match in
                match.slots.contains { slot in
                    slot.source?.sourceMatchId == bracketMatchId
                }
            }
        } ?? laterRounds.first
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

nonisolated struct TournamentBracketRoundSection: Identifiable, Equatable {
    let id: String
    let name: String
    let sequence: Int
    let matchups: [TournamentBracketMatchup]
}

nonisolated struct TournamentBracketMatchup: Identifiable, Equatable {
    let id: String
    let matchId: String?
    let title: String
    let statusText: String
    let slots: [TournamentBracketTeamSlot]
    let progressionText: String?
    let isAvailable: Bool
}

nonisolated struct TournamentBracketTeamSlot: Identifiable, Equatable {
    let id: String
    let teamId: String?
    let teamName: String
    let seed: Int?
    let score: Int?
    let isWinner: Bool
}
