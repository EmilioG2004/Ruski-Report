//
//  PublicMatchMapper.swift
//  Ruski Report
//

import Foundation

nonisolated enum PublicMatchMapper {
    static func matches(
        from envelope: PublicMatchListEnvelopeDTO,
        expectedTournamentId: String,
        expectedVersion: Int64
    ) throws -> [PublicMatchSummary] {
        try PublicContractMapper.validateContractVersion(envelope.contractVersion)
        let projection = try PublicContractMapper.projection(
            envelope.projection,
            expectedTournamentId: expectedTournamentId,
            expectedVersion: expectedVersion
        )
        try PublicContractMapper.requireUnique(envelope.matches.map(\.id), kind: "match")
        return try envelope.matches.map {
            try summary($0, projection: projection, knownTeams: nil)
        }
    }

    static func detail(
        from envelope: PublicMatchDetailEnvelopeDTO,
        expectedTournamentId: String,
        expectedMatchId: String,
        expectedVersion: Int64
    ) throws -> PublicMatchDetail {
        try PublicContractMapper.validateContractVersion(envelope.contractVersion)
        let projection = try PublicContractMapper.projection(
            envelope.projection,
            expectedTournamentId: expectedTournamentId,
            expectedVersion: expectedVersion
        )
        guard envelope.match.id == expectedMatchId else {
            throw PublicContractValidationError.identifierMismatch(
                field: "match.id",
                expected: expectedMatchId,
                actual: envelope.match.id
            )
        }
        return try detail(envelope.match, projection: projection)
    }

    static func summary(
        _ dto: PublicMatchSummaryDTO,
        projection: PublicProjectionReference,
        knownTeams: [String: String]?
    ) throws -> PublicMatchSummary {
        try mapSummary(
            id: dto.id,
            stage: dto.stage,
            sequence: dto.sequence,
            podId: dto.podId,
            bracketMatchId: dto.bracketMatchId,
            instance: dto.instance,
            revision: dto.revision,
            status: dto.status,
            scoreAvailability: dto.scoreAvailability,
            correction: dto.correction,
            timestamps: dto.timestamps,
            participants: dto.participants,
            winner: dto.winner,
            projection: projection,
            knownTeams: knownTeams
        )
    }

    static func detail(
        _ dto: PublicMatchDTO,
        projection: PublicProjectionReference,
        knownTeams: [String: String]? = nil
    ) throws -> PublicMatchDetail {
        let summary = try mapSummary(
            id: dto.id,
            stage: dto.stage,
            sequence: dto.sequence,
            podId: dto.podId,
            bracketMatchId: dto.bracketMatchId,
            instance: dto.instance,
            revision: dto.revision,
            status: dto.status,
            scoreAvailability: dto.scoreAvailability,
            correction: dto.correction,
            timestamps: dto.timestamps,
            participants: dto.participants,
            winner: dto.winner,
            projection: projection,
            knownTeams: knownTeams
        )

        try PublicContractMapper.requireUnique(dto.events.map(\.id), kind: "match_event")
        try PublicContractMapper.requireUnique(
            dto.events.map { String($0.sequence) },
            kind: "match_event_sequence"
        )

        let participantTeams = Dictionary(
            uniqueKeysWithValues: summary.participants.map { ($0.team.id, $0.team.name) }
        )
        let participantPlayers = Dictionary(
            uniqueKeysWithValues: summary.participants.flatMap(\.players).map {
                ($0.id, $0.displayName)
            }
        )
        let events = try dto.events.map { event in
            try PublicContractMapper.requireIdentity(event.id, field: "match.event.id")
            try PublicContractMapper.requirePositive(
                event.sequence,
                field: "match.event.sequence"
            )
            try PublicContractMapper.requireIdentity(event.type, field: "match.event.type")
            if let teamId = event.teamId {
                try PublicContractMapper.requireReference(
                    teamId,
                    in: Set(participantTeams.keys),
                    kind: "match participant team"
                )
            }
            if let playerId = event.playerId {
                try PublicContractMapper.requireReference(
                    playerId,
                    in: Set(participantPlayers.keys),
                    kind: "match participant player"
                )
            }
            if let occurredAt = event.occurredAt {
                try PublicContractMapper.requireTimestamp(
                    occurredAt,
                    field: "match.event.occurredAt"
                )
            }
            return PublicMatchEvent(
                id: event.id,
                sequence: event.sequence,
                type: event.type,
                teamId: event.teamId,
                playerId: event.playerId,
                occurredAt: event.occurredAt,
                details: event.details
            )
        }
        let statistics = try dto.statistics.map {
            try PublicStatisticMapper.statistic(
                $0,
                knownTeams: participantTeams,
                knownPlayers: participantPlayers
            )
        }

        return PublicMatchDetail(
            id: dto.id,
            summary: summary,
            events: events,
            statistics: statistics,
            boxScore: try dto.boxScore.map {
                try boxScore(
                    $0,
                    teams: participantTeams,
                    players: participantPlayers
                )
            },
            scorecard: try dto.scorecard.map {
                try scorecard(
                    $0,
                    participants: summary.participants
                )
            }
        )
    }

    private static func mapSummary(
        id: String,
        stage rawStage: String,
        sequence: Int,
        podId: String?,
        bracketMatchId: String?,
        instance: Int,
        revision: Int?,
        status rawStatus: String,
        scoreAvailability rawAvailability: String,
        correction dtoCorrection: PublicMatchCorrectionDTO,
        timestamps dtoTimestamps: PublicMatchTimestampsDTO,
        participants dtoParticipants: [PublicMatchParticipantDTO],
        winner dtoWinner: PublicTeamIdentityDTO?,
        projection: PublicProjectionReference,
        knownTeams: [String: String]?
    ) throws -> PublicMatchSummary {
        try PublicContractMapper.requireIdentity(id, field: "match.id")
        try PublicContractMapper.requirePositive(sequence, field: "match.sequence")
        try PublicContractMapper.requirePositive(instance, field: "match.instance")
        if let revision {
            try PublicContractMapper.requirePositive(revision, field: "match.revision")
        }
        guard let stage = PublicMatchStage(rawValue: rawStage) else {
            throw PublicContractValidationError.invalidValue(
                field: "match.stage",
                value: rawStage
            )
        }
        guard let status = PublicMatchStatus(rawValue: rawStatus) else {
            throw PublicContractValidationError.invalidValue(
                field: "match.status",
                value: rawStatus
            )
        }
        guard let scoreAvailability = PublicScoreAvailability(rawValue: rawAvailability) else {
            throw PublicContractValidationError.invalidValue(
                field: "match.scoreAvailability",
                value: rawAvailability
            )
        }
        try validateStage(stage, podId: podId, bracketMatchId: bracketMatchId)
        try validateStatus(status, scoreAvailability: scoreAvailability)

        guard dtoParticipants.count == 2 else {
            throw PublicContractValidationError.incoherent(
                "Public matches must contain exactly two participants."
            )
        }
        try PublicContractMapper.requireUnique(
            dtoParticipants.map { String($0.side) },
            kind: "match participant side"
        )
        try PublicContractMapper.requireUnique(
            dtoParticipants.map(\.team.id),
            kind: "match participant team"
        )

        let participants = try dtoParticipants.map {
            try participant($0, knownTeams: knownTeams)
        }.sorted { $0.side < $1.side }
        guard participants.map(\.side) == [1, 2] else {
            throw PublicContractValidationError.incoherent(
                "Public match participant sides must be 1 and 2."
            )
        }
        try PublicContractMapper.requireUnique(
            participants.flatMap(\.players).map(\.id),
            kind: "historical match player"
        )

        let winner = try dtoWinner.map {
            try PublicContractMapper.requireTeamIdentity(
                $0,
                knownTeams: Dictionary(
                    uniqueKeysWithValues: participants.map { ($0.team.id, $0.team.name) }
                )
            )
        }
        try validateParticipantState(
            participants,
            status: status,
            scoreAvailability: scoreAvailability,
            winner: winner
        )
        let correction = try correction(dtoCorrection)
        try PublicContractMapper.requireTimestamp(
            dtoTimestamps.updatedAt,
            field: "match.timestamps.updatedAt"
        )
        for (field, value) in [
            ("scheduledAt", dtoTimestamps.scheduledAt),
            ("startedAt", dtoTimestamps.startedAt),
            ("endedAt", dtoTimestamps.endedAt)
        ] {
            if let value {
                try PublicContractMapper.requireTimestamp(
                    value,
                    field: "match.timestamps.\(field)"
                )
            }
        }

        return PublicMatchSummary(
            id: id,
            tournamentId: projection.tournamentId,
            projection: projection,
            stage: stage,
            sequence: sequence,
            podId: podId,
            bracketMatchId: bracketMatchId,
            instance: instance,
            revision: revision,
            status: status,
            scoreAvailability: scoreAvailability,
            correction: correction,
            timestamps: PublicMatchTimestamps(
                scheduledAt: dtoTimestamps.scheduledAt,
                startedAt: dtoTimestamps.startedAt,
                endedAt: dtoTimestamps.endedAt,
                updatedAt: dtoTimestamps.updatedAt
            ),
            participants: participants,
            winner: winner
        )
    }

    private static func participant(
        _ dto: PublicMatchParticipantDTO,
        knownTeams: [String: String]?
    ) throws -> PublicMatchParticipant {
        guard let role = PublicParticipantRole(rawValue: dto.role) else {
            throw PublicContractValidationError.invalidValue(
                field: "match.participant.role",
                value: dto.role
            )
        }
        guard (dto.side == 1 && role == .home) || (dto.side == 2 && role == .away) else {
            throw PublicContractValidationError.incoherent(
                "Participant side and role must agree."
            )
        }
        if let seed = dto.seed {
            try PublicContractMapper.requirePositive(seed, field: "match.participant.seed")
        }
        if let score = dto.score {
            try PublicContractMapper.requireNonnegative(score, field: "match.participant.score")
        }
        let result: PublicParticipantResult?
        if let rawResult = dto.result {
            guard let mapped = PublicParticipantResult(rawValue: rawResult) else {
                throw PublicContractValidationError.invalidValue(
                    field: "match.participant.result",
                    value: rawResult
                )
            }
            result = mapped
        } else {
            result = nil
        }
        try PublicContractMapper.requireUnique(dto.players.map(\.id), kind: "participant player")
        try PublicContractMapper.requireUnique(
            dto.players.map { String($0.rosterSlot) },
            kind: "participant roster slot"
        )

        return PublicMatchParticipant(
            side: dto.side,
            role: role,
            team: try PublicContractMapper.requireTeamIdentity(
                dto.team,
                knownTeams: knownTeams
            ),
            players: try dto.players.map(PublicContractMapper.player),
            seed: dto.seed,
            score: dto.score,
            result: result
        )
    }

    private static func correction(
        _ dto: PublicMatchCorrectionDTO
    ) throws -> PublicMatchCorrection {
        if dto.isCorrection {
            guard let reason = dto.reason,
                  !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let previousRevision = dto.previousRevision,
                  previousRevision > 0 else {
                throw PublicContractValidationError.incoherent(
                    "Corrected matches require a reason and previous revision."
                )
            }
        } else if dto.reason != nil || dto.previousRevision != nil ||
                    dto.replacesMatchId != nil || dto.replacedByMatchId != nil {
            throw PublicContractValidationError.incoherent(
                "Uncorrected matches cannot contain correction metadata."
            )
        }
        if let matchId = dto.replacesMatchId {
            try PublicContractMapper.requireIdentity(
                matchId,
                field: "match.correction.replacesMatchId"
            )
        }
        if let matchId = dto.replacedByMatchId {
            try PublicContractMapper.requireIdentity(
                matchId,
                field: "match.correction.replacedByMatchId"
            )
        }

        return PublicMatchCorrection(
            isCorrection: dto.isCorrection,
            reason: dto.reason,
            previousRevision: dto.previousRevision,
            replacesMatchId: dto.replacesMatchId,
            replacedByMatchId: dto.replacedByMatchId
        )
    }

    private static func validateStage(
        _ stage: PublicMatchStage,
        podId: String?,
        bracketMatchId: String?
    ) throws {
        switch stage {
        case .podPlay:
            guard podId != nil, bracketMatchId == nil else {
                throw PublicContractValidationError.incoherent(
                    "Pod matches require only a pod identity."
                )
            }
        case .playoffs:
            guard podId == nil, bracketMatchId != nil else {
                throw PublicContractValidationError.incoherent(
                    "Playoff matches require only a bracket-match identity."
                )
            }
        }
    }

    private static func validateStatus(
        _ status: PublicMatchStatus,
        scoreAvailability: PublicScoreAvailability
    ) throws {
        let valid: Bool
        switch status {
        case .scheduled:
            valid = scoreAvailability == .notStarted
        case .inProgress:
            valid = scoreAvailability == .partial
        case .final:
            valid = scoreAvailability == .complete || scoreAvailability == .unrecorded
        case .forfeited, .cancelled:
            valid = scoreAvailability == .notApplicable
        case .postponed:
            valid = scoreAvailability == .notStarted || scoreAvailability == .partial
        }
        guard valid else {
            throw PublicContractValidationError.incoherent(
                "Match status and score availability are inconsistent."
            )
        }
    }

    private static func validateParticipantState(
        _ participants: [PublicMatchParticipant],
        status: PublicMatchStatus,
        scoreAvailability: PublicScoreAvailability,
        winner: PublicTeamIdentity?
    ) throws {
        if scoreAvailability == .complete {
            guard participants.allSatisfy({ $0.score != nil }) else {
                throw PublicContractValidationError.incoherent(
                    "Complete scores require a value for each participant."
                )
            }
        }
        if status == .scheduled || status == .inProgress || status == .postponed ||
            status == .cancelled {
            guard winner == nil else {
                throw PublicContractValidationError.incoherent(
                    "An unresolved match cannot have a winner."
                )
            }
        }
        if let winner {
            guard participants.contains(where: { $0.team.id == winner.id }) else {
                throw PublicContractValidationError.missingReference(
                    kind: "winning participant",
                    id: winner.id
                )
            }
        }
    }

    private static func boxScore(
        _ dto: PublicBoxScoreDTO,
        teams: [String: String],
        players: [String: String]
    ) throws -> PublicBoxScore {
        try PublicContractMapper.requireUnique(dto.columns.map(\.key), kind: "box score column")
        try PublicContractMapper.requireUnique(dto.rows.map(\.id), kind: "box score row")
        let columnKeys = Set(dto.columns.map(\.key))
        let columns = try dto.columns.map { column in
            guard let format = PublicBoxScoreColumnFormat(rawValue: column.format) else {
                throw PublicContractValidationError.invalidValue(
                    field: "boxScore.column.format",
                    value: column.format
                )
            }
            return PublicBoxScoreColumn(key: column.key, label: column.label, format: format)
        }
        let rows = try dto.rows.map { row in
            try PublicContractMapper.requireReference(
                row.teamId,
                in: Set(teams.keys),
                kind: "box score team"
            )
            guard Set(row.values.keys).isSubset(of: columnKeys) else {
                throw PublicContractValidationError.incoherent(
                    "Box-score rows contain an undeclared value."
                )
            }
            guard let type = PublicBoxScoreSubjectType(rawValue: row.subject.type) else {
                throw PublicContractValidationError.invalidValue(
                    field: "boxScore.subject.type",
                    value: row.subject.type
                )
            }
            let names = type == .team ? teams : players
            guard names[row.subject.id] == row.subject.displayName else {
                throw PublicContractValidationError.missingReference(
                    kind: "box score subject",
                    id: row.subject.id
                )
            }
            return PublicBoxScoreRow(
                id: row.id,
                subjectId: row.subject.id,
                subjectDisplayName: row.subject.displayName,
                subjectType: type,
                teamId: row.teamId,
                values: row.values
            )
        }
        guard Set(dto.totals.keys).isSubset(of: columnKeys) else {
            throw PublicContractValidationError.incoherent(
                "Box-score totals contain an undeclared value."
            )
        }
        return PublicBoxScore(columns: columns, rows: rows, totals: dto.totals)
    }

    private static func scorecard(
        _ dto: PublicScorecardDTO,
        participants: [PublicMatchParticipant]
    ) throws -> PublicScorecard {
        try PublicContractMapper.requireUnique(dto.columns.map(\.key), kind: "scorecard column")
        try PublicContractMapper.requireUnique(dto.rows.map(\.id), kind: "scorecard row")
        let columns = try dto.columns.map { column in
            guard let kind = PublicScorecardColumnKind(rawValue: column.kind) else {
                throw PublicContractValidationError.invalidValue(
                    field: "scorecard.column.kind",
                    value: column.kind
                )
            }
            return PublicScorecardColumn(key: column.key, label: column.label, kind: kind)
        }
        let columnKeys = Set(columns.map(\.key))
        let participantBySide = Dictionary(uniqueKeysWithValues: participants.map { ($0.side, $0) })
        let rows = try dto.rows.map { row in
            try PublicContractMapper.requirePositive(
                row.sequence,
                field: "scorecard.row.sequence"
            )
            guard let participant = participantBySide[row.side],
                  participant.team.id == row.teamId else {
                throw PublicContractValidationError.missingReference(
                    kind: "scorecard participant",
                    id: row.teamId
                )
            }
            guard Set(row.values.keys).isSubset(of: columnKeys) else {
                throw PublicContractValidationError.incoherent(
                    "Scorecard rows contain an undeclared value."
                )
            }
            for value in row.values.values {
                switch value {
                case .object, .array:
                    throw PublicContractValidationError.incoherent(
                        "Scorecard values must be scalar JSON values."
                    )
                case .string, .number, .bool, .null:
                    break
                }
            }
            if let playerId = row.playerId {
                guard let player = participant.players.first(where: { $0.id == playerId }),
                      player.displayName == row.playerDisplayName else {
                    throw PublicContractValidationError.missingReference(
                        kind: "scorecard player",
                        id: playerId
                    )
                }
            } else if row.playerDisplayName != nil {
                throw PublicContractValidationError.incoherent(
                    "Scorecard player identity must be complete."
                )
            }
            return PublicScorecardRow(
                id: row.id,
                sequence: row.sequence,
                side: row.side,
                teamId: row.teamId,
                playerId: row.playerId,
                playerDisplayName: row.playerDisplayName,
                values: row.values
            )
        }
        return PublicScorecard(columns: columns, rows: rows)
    }
}
