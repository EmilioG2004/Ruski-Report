//
//  PublicTournamentMapper.swift
//  Ruski Report
//

import Foundation

nonisolated enum PublicTournamentMapper {
    static func activeTournaments(
        from envelope: PublicTournamentDiscoveryEnvelopeDTO
    ) throws -> [PublicTournamentSummary] {
        try discoveryTournaments(
            from: envelope,
            allowedLifecycles: [.setupPublished, .podPlay, .seedingReview, .playoffs],
            collectionName: "Active discovery"
        )
    }

    static func historicalTournaments(
        from envelope: PublicTournamentDiscoveryEnvelopeDTO
    ) throws -> [PublicTournamentSummary] {
        try discoveryTournaments(
            from: envelope,
            allowedLifecycles: [.completed, .archived],
            collectionName: "History discovery"
        )
    }

    private static func discoveryTournaments(
        from envelope: PublicTournamentDiscoveryEnvelopeDTO,
        allowedLifecycles: [PublicTournamentLifecycle],
        collectionName: String
    ) throws -> [PublicTournamentSummary] {
        try PublicContractMapper.validateContractVersion(envelope.contractVersion)
        try PublicContractMapper.requireUnique(
            envelope.tournaments.map(\.tournament.id),
            kind: "tournament"
        )

        return try envelope.tournaments.map { item in
            let projection = try PublicContractMapper.projection(
                item.projection,
                expectedTournamentId: item.tournament.id
            )
            let tournament = try summary(item.tournament, projection: projection)
            guard allowedLifecycles.contains(tournament.lifecycle) else {
                throw PublicContractValidationError.incoherent(
                    "\(collectionName) contained an unsupported tournament lifecycle."
                )
            }
            return tournament
        }
    }

    static func detail(
        from envelope: PublicTournamentDetailEnvelopeDTO,
        expectedTournamentId: String,
        expectedVersion: Int64
    ) throws -> PublicTournamentDetail {
        try PublicContractMapper.validateContractVersion(envelope.contractVersion)
        let projection = try PublicContractMapper.projection(
            envelope.projection,
            expectedTournamentId: expectedTournamentId,
            expectedVersion: expectedVersion
        )
        guard envelope.tournament.id == expectedTournamentId else {
            throw PublicContractValidationError.identifierMismatch(
                field: "tournament.id",
                expected: expectedTournamentId,
                actual: envelope.tournament.id
            )
        }
        return try detail(envelope.tournament, projection: projection)
    }

    private static func summary(
        _ dto: PublicTournamentSummaryDTO,
        projection: PublicProjectionReference
    ) throws -> PublicTournamentSummary {
        try PublicContractMapper.requireIdentity(dto.id, field: "tournament.id")
        try PublicContractMapper.requireIdentity(dto.gameType, field: "tournament.gameType")
        try PublicContractMapper.requireIdentity(dto.name, field: "tournament.name")
        try PublicContractMapper.requirePositive(dto.year, field: "tournament.year")
        guard let lifecycle = PublicTournamentLifecycle(rawValue: dto.lifecycle) else {
            throw PublicContractValidationError.invalidValue(
                field: "tournament.lifecycle",
                value: dto.lifecycle
            )
        }
        return PublicTournamentSummary(
            id: dto.id,
            gameType: dto.gameType,
            year: dto.year,
            name: dto.name,
            lifecycle: lifecycle,
            projection: projection
        )
    }

    private static func detail(
        _ dto: PublicTournamentDTO,
        projection: PublicProjectionReference
    ) throws -> PublicTournamentDetail {
        let summary = try summary(
            PublicTournamentSummaryDTO(
                id: dto.id,
                gameType: dto.gameType,
                year: dto.year,
                name: dto.name,
                lifecycle: dto.lifecycle
            ),
            projection: projection
        )

        try PublicContractMapper.requireUnique(dto.rosters.map(\.id), kind: "roster team")
        try PublicContractMapper.requireUnique(dto.pods.map(\.id), kind: "pod")
        try PublicContractMapper.requireUnique(
            dto.pods.map { String($0.sequence) },
            kind: "pod sequence"
        )
        try PublicContractMapper.requireUnique(dto.matches.map(\.id), kind: "match")
        try PublicContractMapper.requireUnique(
            dto.seeds.map(\.team.id),
            kind: "effective seed team"
        )

        let teamNames = Dictionary(uniqueKeysWithValues: dto.rosters.map { ($0.id, $0.name) })
        let teamIds = Set(teamNames.keys)
        let podIds = Set(dto.pods.map(\.id))
        let format = try mapFormat(dto.format)
        guard format.teamCount == dto.rosters.count,
              format.podCount == dto.pods.count else {
            throw PublicContractValidationError.incoherent(
                "Tournament format counts do not match the public roster and pod projection."
            )
        }

        var currentPlayerNames: [String: String] = [:]
        let rosters = try dto.rosters.map { roster in
            try PublicContractMapper.requireIdentity(roster.name, field: "roster.name")
            try PublicContractMapper.requireReference(roster.podId, in: podIds, kind: "roster pod")
            try PublicContractMapper.requirePositive(
                roster.initialPodSeed,
                field: "roster.initialPodSeed"
            )
            try PublicContractMapper.requireUnique(roster.players.map(\.id), kind: "roster player")
            try PublicContractMapper.requireUnique(
                roster.players.map { String($0.rosterSlot) },
                kind: "roster slot"
            )
            let players = try roster.players.map(PublicContractMapper.player)
            for player in players {
                if let existing = currentPlayerNames.updateValue(
                    player.displayName,
                    forKey: player.id
                ), existing != player.displayName {
                    throw PublicContractValidationError.identifierMismatch(
                        field: "player.displayName",
                        expected: existing,
                        actual: player.displayName
                    )
                }
            }
            return PublicRosterTeam(
                id: roster.id,
                name: roster.name,
                podId: roster.podId,
                initialPodSeed: roster.initialPodSeed,
                players: players
            )
        }
        try validateRosterSeeds(rosters, pods: dto.pods)

        let matches = try dto.matches.map {
            try PublicMatchMapper.summary(
                $0,
                projection: projection,
                knownTeams: teamNames
            )
        }
        let matchIds = Set(matches.map(\.id))
        var allPlayerNames = currentPlayerNames
        for player in matches.flatMap(\.participants).flatMap(\.players) {
            if let existing = allPlayerNames.updateValue(player.displayName, forKey: player.id),
               existing != player.displayName {
                throw PublicContractValidationError.identifierMismatch(
                    field: "historicalPlayer.displayName",
                    expected: existing,
                    actual: player.displayName
                )
            }
        }

        let pods = try dto.pods.map {
            try mapPod($0, teamNames: teamNames)
        }
        try validateTeamPodMembership(rosters: rosters, pods: pods)
        let seeds = try mapSeeds(dto.seeds, teamNames: teamNames)
        let statistics = try dto.statistics.map {
            try PublicStatisticMapper.statistic(
                $0,
                knownTeams: teamNames,
                knownPlayers: allPlayerNames
            )
        }
        try validateStatisticReferences(
            statistics,
            tournamentId: dto.id,
            teamIds: teamIds,
            playerIds: Set(allPlayerNames.keys),
            podIds: podIds,
            matchIds: matchIds
        )
        let bracket = try dto.bracket.map {
            try mapBracket(
                $0,
                teamNames: teamNames,
                matches: matches
            )
        }

        return PublicTournamentDetail(
            id: summary.id,
            gameType: summary.gameType,
            year: summary.year,
            name: summary.name,
            lifecycle: summary.lifecycle,
            projection: projection,
            format: format,
            rosters: rosters,
            pods: pods,
            seeds: seeds,
            statistics: statistics,
            matches: matches,
            bracket: bracket
        )
    }

    private static func mapFormat(
        _ dto: PublicTournamentFormatDTO
    ) throws -> PublicTournamentFormat {
        guard dto.formatVersion == 1 else {
            throw PublicContractValidationError.invalidValue(
                field: "tournament.format.formatVersion",
                value: String(dto.formatVersion)
            )
        }
        guard dto.formatType == "pod_and_single_elimination" else {
            throw PublicContractValidationError.invalidValue(
                field: "tournament.format.formatType",
                value: dto.formatType
            )
        }
        for (field, value) in [
            ("teamCount", dto.teamCount),
            ("podCount", dto.podCount),
            ("playersPerTeam", dto.playersPerTeam),
            ("gamesPerPair", dto.gamesPerPair),
            ("qualifiersPerPod", dto.qualifiersPerPod),
            ("bracketSize", dto.bracketSize)
        ] {
            try PublicContractMapper.requirePositive(
                value,
                field: "tournament.format.\(field)"
            )
        }
        guard dto.podSizes.count == dto.podCount,
              dto.podSizes.allSatisfy({ $0 > 0 }),
              dto.podSizes.reduce(0, +) == dto.teamCount else {
            throw PublicContractValidationError.incoherent(
                "Tournament pod sizes must be positive and sum to the team count."
            )
        }
        let rules = try dto.standingsRules.map { value in
            guard let rule = PublicStandingsRule(rawValue: value) else {
                throw PublicContractValidationError.invalidValue(
                    field: "tournament.format.standingsRules",
                    value: value
                )
            }
            return rule
        }
        try PublicContractMapper.requireUnique(
            rules.map(\.rawValue),
            kind: "standings rule"
        )

        return PublicTournamentFormat(
            formatVersion: dto.formatVersion,
            teamCount: dto.teamCount,
            podCount: dto.podCount,
            podSizes: dto.podSizes,
            playersPerTeam: dto.playersPerTeam,
            gamesPerPair: dto.gamesPerPair,
            qualifiersPerPod: dto.qualifiersPerPod,
            bracketSize: dto.bracketSize,
            allowByes: dto.allowByes,
            standingsRules: rules,
            copiedFromPresetId: dto.copiedFromPresetId
        )
    }

    private static func mapPod(
        _ dto: PublicPodDTO,
        teamNames: [String: String]
    ) throws -> PublicPod {
        try PublicContractMapper.requireIdentity(dto.name, field: "pod.name")
        try PublicContractMapper.requirePositive(dto.sequence, field: "pod.sequence")
        guard let state = PublicStandingState(rawValue: dto.standingState) else {
            throw PublicContractValidationError.invalidValue(
                field: "pod.standingState",
                value: dto.standingState
            )
        }
        try PublicContractMapper.requireUnique(
            dto.standings.map(\.team.id),
            kind: "pod standing team"
        )
        let standings = try dto.standings.map { standing in
            for (field, value) in [
                ("wins", standing.wins),
                ("losses", standing.losses),
                ("makes", standing.makes),
                ("attempts", standing.attempts)
            ] {
                try PublicContractMapper.requireNonnegative(
                    value,
                    field: "standing.\(field)"
                )
            }
            if let rank = standing.rank {
                try PublicContractMapper.requirePositive(rank, field: "standing.rank")
            }
            return PublicStanding(
                team: try PublicContractMapper.requireTeamIdentity(
                    standing.team,
                    knownTeams: teamNames
                ),
                rank: standing.rank,
                wins: standing.wins,
                losses: standing.losses,
                cupDifferential: standing.cupDifferential,
                makes: standing.makes,
                attempts: standing.attempts,
                shootingPercentage: standing.shootingPercentage,
                tieGroup: standing.tieGroup,
                administratorResolved: standing.administratorResolved
            )
        }
        if let finalizedAt = dto.finalizedAt {
            try PublicContractMapper.requireTimestamp(
                finalizedAt,
                field: "pod.finalizedAt"
            )
        }

        switch state {
        case .zeroGame:
            guard dto.finalizedAt == nil,
                  standings.allSatisfy({
                      $0.rank == nil && $0.wins == 0 && $0.losses == 0 &&
                          $0.makes == 0 && $0.attempts == 0
                  }) else {
                throw PublicContractValidationError.incoherent(
                    "Zero-game standings cannot contain results or finalization."
                )
            }
        case .active:
            guard dto.finalizedAt == nil else {
                throw PublicContractValidationError.incoherent(
                    "Active pod standings cannot be finalized."
                )
            }
        case .finalized:
            guard dto.finalizedAt != nil,
                  standings.allSatisfy({ $0.rank != nil }) else {
                throw PublicContractValidationError.incoherent(
                    "Finalized pods require ranked standings and a finalization time."
                )
            }
        case .unresolvedTie:
            guard dto.finalizedAt == nil,
                  standings.contains(where: { $0.tieGroup != nil }) else {
                throw PublicContractValidationError.incoherent(
                    "Unresolved ties require a tie group and cannot be finalized."
                )
            }
        }

        return PublicPod(
            id: dto.id,
            name: dto.name,
            sequence: dto.sequence,
            standingState: state,
            finalizedAt: dto.finalizedAt,
            standings: standings
        )
    }

    private static func mapSeeds(
        _ dtos: [PublicSeedDTO],
        teamNames: [String: String]
    ) throws -> [PublicSeed] {
        var calculated = Set<Int>()
        var effective = Set<Int>()
        return try dtos.map { dto in
            if let seed = dto.calculatedSeed {
                try PublicContractMapper.requirePositive(seed, field: "seed.calculatedSeed")
                guard calculated.insert(seed).inserted else {
                    throw PublicContractValidationError.duplicateIdentity(
                        kind: "calculated seed",
                        id: String(seed)
                    )
                }
            }
            if let seed = dto.effectiveSeed {
                try PublicContractMapper.requirePositive(seed, field: "seed.effectiveSeed")
                guard effective.insert(seed).inserted else {
                    throw PublicContractValidationError.duplicateIdentity(
                        kind: "effective seed",
                        id: String(seed)
                    )
                }
            }
            guard dto.overridden || dto.calculatedSeed == dto.effectiveSeed else {
                throw PublicContractValidationError.incoherent(
                    "A non-overridden seed must equal its calculated seed."
                )
            }
            return PublicSeed(
                team: try PublicContractMapper.requireTeamIdentity(
                    dto.team,
                    knownTeams: teamNames
                ),
                calculatedSeed: dto.calculatedSeed,
                effectiveSeed: dto.effectiveSeed,
                overridden: dto.overridden
            )
        }
    }

    private static func mapBracket(
        _ dto: PublicBracketDTO,
        teamNames: [String: String],
        matches: [PublicMatchSummary]
    ) throws -> PublicBracket {
        try PublicContractMapper.requireIdentity(dto.id, field: "bracket.id")
        try PublicContractMapper.requireIdentity(dto.name, field: "bracket.name")
        try PublicContractMapper.requirePositive(dto.size, field: "bracket.size")
        try PublicContractMapper.requireUnique(dto.rounds.map(\.id), kind: "bracket round")
        try PublicContractMapper.requireUnique(
            dto.rounds.map { String($0.sequence) },
            kind: "bracket round sequence"
        )
        let allNodes = dto.rounds.flatMap(\.matches)
        try PublicContractMapper.requireUnique(allNodes.map(\.id), kind: "bracket match")
        let nodeIds = Set(allNodes.map(\.id))
        let matchById = Dictionary(uniqueKeysWithValues: matches.map { ($0.id, $0) })

        let rounds = try dto.rounds.map { round in
            try PublicContractMapper.requirePositive(
                round.sequence,
                field: "bracket.round.sequence"
            )
            try PublicContractMapper.requireUnique(
                round.matches.map { String($0.position) },
                kind: "bracket round position"
            )
            let mappedMatches = try round.matches.map { node in
                try mapBracketMatch(
                    node,
                    teamNames: teamNames,
                    nodeIds: nodeIds,
                    matchById: matchById
                )
            }
            return PublicBracketRound(
                id: round.id,
                name: round.name,
                sequence: round.sequence,
                matches: mappedMatches
            )
        }
        return PublicBracket(id: dto.id, name: dto.name, size: dto.size, rounds: rounds)
    }

    private static func mapBracketMatch(
        _ dto: PublicBracketMatchDTO,
        teamNames: [String: String],
        nodeIds: Set<String>,
        matchById: [String: PublicMatchSummary]
    ) throws -> PublicBracketMatch {
        try PublicContractMapper.requirePositive(dto.round, field: "bracketMatch.round")
        try PublicContractMapper.requirePositive(dto.position, field: "bracketMatch.position")
        guard let status = PublicBracketMatchStatus(rawValue: dto.status) else {
            throw PublicContractValidationError.invalidValue(
                field: "bracketMatch.status",
                value: dto.status
            )
        }
        guard dto.slots.count == 2 else {
            throw PublicContractValidationError.incoherent(
                "Bracket matches must contain exactly two slots."
            )
        }
        if let matchId = dto.matchId {
            guard let match = matchById[matchId] else {
                throw PublicContractValidationError.missingReference(
                    kind: "bracket public match",
                    id: matchId
                )
            }
            guard match.bracketMatchId == dto.id else {
                throw PublicContractValidationError.identifierMismatch(
                    field: "match.bracketMatchId",
                    expected: dto.id,
                    actual: match.bracketMatchId ?? ""
                )
            }
        }
        let slots = try dto.slots.map {
            try mapBracketSlot($0, teamNames: teamNames, nodeIds: nodeIds)
        }
        let winner = try dto.winner.map {
            try PublicContractMapper.requireTeamIdentity($0, knownTeams: teamNames)
        }

        if status == .bye {
            guard dto.matchId == nil,
                  slots.contains(where: { if case .bye = $0 { true } else { false } }),
                  winner != nil else {
                throw PublicContractValidationError.incoherent(
                    "Bye nodes require a bye slot, an advanced team, and no match."
                )
            }
        }

        return PublicBracketMatch(
            id: dto.id,
            round: dto.round,
            position: dto.position,
            status: status,
            matchId: dto.matchId,
            replacedMatchId: dto.replacedMatchId,
            slots: slots,
            winner: winner
        )
    }

    private static func mapBracketSlot(
        _ dto: PublicBracketSlotDTO,
        teamNames: [String: String],
        nodeIds: Set<String>
    ) throws -> PublicBracketSlot {
        switch dto.source {
        case "team":
            guard let team = dto.team, dto.sourceBracketMatchId == nil else {
                throw PublicContractValidationError.incoherent(
                    "Team bracket slots require only a team source."
                )
            }
            if let seed = dto.seed {
                try PublicContractMapper.requirePositive(seed, field: "bracketSlot.seed")
            }
            return .team(
                try PublicContractMapper.requireTeamIdentity(team, knownTeams: teamNames),
                seed: dto.seed
            )
        case "match_winner":
            guard let sourceId = dto.sourceBracketMatchId else {
                throw PublicContractValidationError.incoherent(
                    "Winner bracket slots require a source bracket match."
                )
            }
            try PublicContractMapper.requireReference(
                sourceId,
                in: nodeIds,
                kind: "source bracket match"
            )
            if let seed = dto.seed {
                try PublicContractMapper.requirePositive(seed, field: "bracketSlot.seed")
            }
            return .matchWinner(
                sourceBracketMatchId: sourceId,
                team: try dto.team.map {
                    try PublicContractMapper.requireTeamIdentity($0, knownTeams: teamNames)
                },
                seed: dto.seed
            )
        case "bye":
            guard dto.team == nil, dto.seed == nil, dto.sourceBracketMatchId == nil else {
                throw PublicContractValidationError.incoherent(
                    "Bye bracket slots cannot contain an identity or seed."
                )
            }
            return .bye
        case "tbd":
            guard dto.team == nil, dto.seed == nil, dto.sourceBracketMatchId == nil else {
                throw PublicContractValidationError.incoherent(
                    "TBD bracket slots cannot contain an identity or seed."
                )
            }
            return .tbd
        default:
            throw PublicContractValidationError.invalidValue(
                field: "bracketSlot.source",
                value: dto.source
            )
        }
    }

    private static func validateRosterSeeds(
        _ rosters: [PublicRosterTeam],
        pods: [PublicPodDTO]
    ) throws {
        for pod in pods {
            let members = rosters.filter { $0.podId == pod.id }
            try PublicContractMapper.requireUnique(
                members.map { String($0.initialPodSeed) },
                kind: "initial pod seed"
            )
        }
    }

    private static func validateTeamPodMembership(
        rosters: [PublicRosterTeam],
        pods: [PublicPod]
    ) throws {
        let rosterByTeam = Dictionary(uniqueKeysWithValues: rosters.map { ($0.id, $0) })
        for pod in pods {
            for standing in pod.standings {
                guard rosterByTeam[standing.team.id]?.podId == pod.id else {
                    throw PublicContractValidationError.identifierMismatch(
                        field: "standing.team.podId",
                        expected: pod.id,
                        actual: rosterByTeam[standing.team.id]?.podId ?? ""
                    )
                }
            }
        }
    }

    private static func validateStatisticReferences(
        _ statistics: [PublicStatistic],
        tournamentId: String,
        teamIds: Set<String>,
        playerIds: Set<String>,
        podIds: Set<String>,
        matchIds: Set<String>
    ) throws {
        for statistic in statistics {
            switch statistic.scope {
            case .tournament:
                guard statistic.scopeId == tournamentId else {
                    throw PublicContractValidationError.identifierMismatch(
                        field: "statistic.scopeId",
                        expected: tournamentId,
                        actual: statistic.scopeId
                    )
                }
            case .team:
                try PublicContractMapper.requireReference(
                    statistic.scopeId,
                    in: teamIds,
                    kind: "statistic team"
                )
            case .player:
                try PublicContractMapper.requireReference(
                    statistic.scopeId,
                    in: playerIds,
                    kind: "statistic player"
                )
            case .pod:
                try PublicContractMapper.requireReference(
                    statistic.scopeId,
                    in: podIds,
                    kind: "statistic pod"
                )
            case .match:
                try PublicContractMapper.requireReference(
                    statistic.scopeId,
                    in: matchIds,
                    kind: "statistic match"
                )
            case .stage:
                guard PublicMatchStage(rawValue: statistic.scopeId) != nil else {
                    throw PublicContractValidationError.invalidValue(
                        field: "statistic.scopeId",
                        value: statistic.scopeId
                    )
                }
            }
        }
    }
}
