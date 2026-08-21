import { PostgresDatabase } from "../../database";
import { TransactionContext } from "../../repositories/transaction";
import { ScoringWriterMode } from "../domain";
import {
  ActivateMatchRevisionInput,
  MatchRevisionRepositoryContract,
  MatchRevisionActivationResult,
  MatchRevisionEventInput
} from "./contracts";
import { TournamentEngineTransactionManager } from "./engine-transaction.manager";
import {
  EnginePersistenceConflictError,
  EnginePersistenceInvariantError
} from "./errors";
import {
  engineExecutor,
  EnginePostgresExecutor,
  lockEngineMatch,
  lockEngineTournament,
  writeEngineAuditEvent,
  writeEngineJson
} from "./postgres-engine-executor";
import { assertEngineWriterFence } from "./postgres-match-writer.repository";

interface LockedMatchRow {
  row_version: string | number;
  active_revision_id: string | null;
  active_revision_number: number | null;
  identity_only: boolean;
}

interface MatchSlotRow {
  side_number: number;
  team_id: string | null;
}

interface FrozenPlayerRow {
  side_number: number;
  team_id: string;
  player_id: string;
  roster_membership_id: string | null;
  roster_slot: number;
}

export class PostgresMatchRevisionRepository
implements MatchRevisionRepositoryContract {
  private readonly transactions: TournamentEngineTransactionManager;

  constructor(
    private readonly database: PostgresDatabase,
    transactions?: TournamentEngineTransactionManager
  ) {
    this.transactions = transactions ?? new TournamentEngineTransactionManager(database);
  }

  activateRevision(
    input: ActivateMatchRevisionInput
  ): Promise<MatchRevisionActivationResult> {
    return this.transactions.run((transaction) =>
      this.activateRevisionInTransaction(input, transaction)
    );
  }

  async activateRevisionInTransaction(
    input: ActivateMatchRevisionInput,
    transaction: TransactionContext
  ): Promise<MatchRevisionActivationResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    await lockEngineMatch(executor, input.matchId);
    const match = await this.lockMatch(executor, input);
    this.assertRevisionSequence(match, input);
    this.assertRevisionReason(input);
    await this.assertWriter(executor, input);
    await this.assertParticipants(executor, input, match.active_revision_id);
    this.assertEvents(input);

    await executor.query(
      `
        INSERT INTO engine_match_revisions (
          id, tournament_id, match_id, public_key, revision_number,
          previous_revision_id, status, score_availability, reason,
          source_adapter, source_reference, actor_id, correction_reason,
          confirmation_digest, created_at, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5,
          $6::uuid, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16::jsonb
        )
      `,
      [
        input.revision.id,
        input.tournamentId,
        input.matchId,
        input.revision.publicKey,
        input.revision.revisionNumber,
        input.revision.previousRevisionId ?? null,
        input.revision.status,
        input.revision.scoreAvailability,
        input.revision.reason,
        input.revision.sourceAdapter,
        input.revision.sourceReference ?? null,
        input.revision.actorId,
        input.revision.correctionReason ?? null,
        input.revision.confirmationDigest ?? null,
        input.revision.createdAt,
        writeEngineJson(input.revision.metadata ?? {})
      ]
    );

    for (const team of input.teams) {
      await executor.query(
        `
          INSERT INTO engine_match_revision_teams (
            tournament_id, revision_id, side_number, team_id, score, result,
            display_name_at_revision, metadata
          ) VALUES (
            $1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7, $8::jsonb
          )
        `,
        [
          input.tournamentId,
          input.revision.id,
          team.sideNumber,
          team.teamId,
          team.score ?? null,
          team.result,
          team.displayName,
          writeEngineJson(team.metadata ?? {})
        ]
      );

      for (const player of team.players) {
        await executor.query(
          `
            INSERT INTO engine_match_revision_players (
              tournament_id, revision_id, side_number, team_id, player_id,
              roster_membership_id, roster_slot, display_name_at_revision,
              metadata
            ) VALUES (
              $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid,
              $6::uuid, $7, $8, $9::jsonb
            )
          `,
          [
            input.tournamentId,
            input.revision.id,
            team.sideNumber,
            team.teamId,
            player.playerId,
            player.rosterMembershipId ?? null,
            player.rosterSlot,
            player.displayName,
            writeEngineJson(player.metadata ?? {})
          ]
        );
      }
    }

    for (const event of input.events) {
      await this.insertEvent(executor, input, event);
    }

    const updated = await executor.query<{ row_version: string | number }>(
      `
        UPDATE engine_matches
        SET active_revision_id = $3::uuid,
            status = $4,
            score_availability = $5,
            participants_frozen_at = COALESCE(participants_frozen_at, $6),
            started_at = CASE
              WHEN $4 IN ('in_progress', 'final')
                THEN COALESCE(started_at, $6::timestamptz)
              ELSE started_at
            END,
            ended_at = CASE
              WHEN $4 IN ('final', 'forfeited', 'cancelled')
                THEN COALESCE(ended_at, $6::timestamptz)
              ELSE ended_at
            END,
            row_version = row_version + 1,
            updated_at = $6
        WHERE id = $1::uuid
          AND tournament_id = $2::uuid
          AND row_version = $7
        RETURNING row_version
      `,
      [
        input.matchId,
        input.tournamentId,
        input.revision.id,
        input.revision.status,
        input.revision.scoreAvailability,
        input.revision.createdAt,
        input.expectedMatchRowVersion
      ]
    );
    const rowVersion = updated.rows[0]?.row_version;
    if (rowVersion === undefined) {
      throw new EnginePersistenceConflictError(
        "Match revision could not be activated at the expected version."
      );
    }

    await writeEngineAuditEvent(
      executor,
      input.tournamentId,
      input.audit,
      input.matchId
    );
    return {
      tournamentId: input.tournamentId,
      matchId: input.matchId,
      revisionId: input.revision.id,
      matchRowVersion: Number(rowVersion)
    };
  }

  private async lockMatch(
    executor: EnginePostgresExecutor,
    input: ActivateMatchRevisionInput
  ): Promise<LockedMatchRow> {
    const result = await executor.query<LockedMatchRow>(
      `
        SELECT match.row_version,
               match.active_revision_id,
               revision.revision_number AS active_revision_number,
               match.identity_only
        FROM engine_matches match
        LEFT JOIN engine_match_revisions revision
          ON revision.id = match.active_revision_id
        WHERE match.id = $1::uuid AND match.tournament_id = $2::uuid
        FOR UPDATE OF match
      `,
      [input.matchId, input.tournamentId]
    );
    const row = result.rows[0];
    if (row === undefined || row.identity_only) {
      throw new EnginePersistenceInvariantError(
        "Writable match was not found in the selected tournament."
      );
    }
    if (Number(row.row_version) !== input.expectedMatchRowVersion) {
      throw new EnginePersistenceConflictError(
        "Match changed after the revision command was prepared."
      );
    }
    return row;
  }

  private assertRevisionSequence(
    match: LockedMatchRow,
    input: ActivateMatchRevisionInput
  ): void {
    const expectedRevisionNumber = Number(match.active_revision_number ?? 0) + 1;
    const expectedPreviousRevisionId = match.active_revision_id ?? undefined;
    if (
      input.revision.revisionNumber !== expectedRevisionNumber ||
      input.revision.previousRevisionId !== expectedPreviousRevisionId
    ) {
      throw new EnginePersistenceConflictError(
        "Match revision does not extend the current active revision."
      );
    }
  }

  private assertRevisionReason(input: ActivateMatchRevisionInput): void {
    if (input.revision.reason !== "correction") {
      return;
    }
    const reason = input.revision.correctionReason?.trim();
    if (reason === undefined || reason.length < 3 || reason.length > 500) {
      throw new EnginePersistenceInvariantError(
        "Canonical correction revisions require a reason between 3 and 500 characters."
      );
    }
  }

  private async assertWriter(
    executor: EnginePostgresExecutor,
    input: ActivateMatchRevisionInput
  ): Promise<void> {
    if (input.revision.sourceAdapter === "legacy_backfill") {
      if (input.writerFence !== undefined) {
        throw new EnginePersistenceInvariantError(
          "Legacy backfill revisions do not use an active scoring writer."
        );
      }
      return;
    }
    const fence = input.writerFence;
    if (fence === undefined) {
      throw new EnginePersistenceInvariantError(
        "Canonical scoring revisions require an active writer fence."
      );
    }
    const expectedMode = sourceWriterMode(input.revision.sourceAdapter);
    if (fence.mode !== expectedMode) {
      throw new EnginePersistenceInvariantError(
        "Revision source adapter does not match the active writer mode."
      );
    }
    await assertEngineWriterFence(executor, {
      matchId: input.matchId,
      ...fence
    });
  }

  private async assertParticipants(
    executor: EnginePostgresExecutor,
    input: ActivateMatchRevisionInput,
    activeRevisionId: string | null
  ): Promise<void> {
    if (input.teams.length !== 2) {
      throw new EnginePersistenceInvariantError(
        "A scored match revision requires exactly two team participants."
      );
    }
    const sideNumbers = input.teams.map((team) => team.sideNumber).sort();
    const teamIds = input.teams.map((team) => team.teamId);
    if (
      sideNumbers[0] !== 1 ||
      sideNumbers[1] !== 2 ||
      new Set(teamIds).size !== 2
    ) {
      throw new EnginePersistenceInvariantError(
        "Match revision sides and team participants must be unique."
      );
    }

    const slotResult = await executor.query<MatchSlotRow>(
      `
        SELECT slot_number AS side_number, team_id
        FROM engine_match_slots
        WHERE match_id = $1::uuid
        ORDER BY slot_number
      `,
      [input.matchId]
    );
    const slots = slotResult.rows;
    if (
      slots.length !== 2 ||
      slots.some((slot) => slot.team_id === null) ||
      slots.some((slot) =>
        input.teams.find((team) => team.sideNumber === slot.side_number)?.teamId !==
          slot.team_id
      )
    ) {
      throw new EnginePersistenceInvariantError(
        "Revision participants must match the resolved stable match slots."
      );
    }

    if (activeRevisionId !== null) {
      const frozen = await executor.query<FrozenPlayerRow>(
        `
          SELECT side_number, team_id, player_id,
                 roster_membership_id, roster_slot
          FROM engine_match_revision_players
          WHERE revision_id = $1::uuid
          ORDER BY side_number, roster_slot, player_id
        `,
        [activeRevisionId]
      );
      const previous = frozen.rows.map(participantKey).sort();
      const proposed = input.teams
        .flatMap((team) =>
          team.players.map((player) =>
            participantKey({
              side_number: team.sideNumber,
              team_id: team.teamId,
              player_id: player.playerId,
              roster_membership_id: player.rosterMembershipId ?? null,
              roster_slot: player.rosterSlot
            })
          )
        )
        .sort();
      if (previous.join("|") !== proposed.join("|")) {
        throw new EnginePersistenceConflictError(
          "Match participants are frozen after the first scoring revision."
        );
      }
    }

    for (const team of input.teams) {
      for (const player of team.players) {
        if (player.rosterMembershipId === undefined) {
          if (input.revision.sourceAdapter !== "legacy_backfill") {
            throw new EnginePersistenceInvariantError(
              "Canonical revision players require roster membership identity."
            );
          }
          continue;
        }
        const membership = await executor.query(
          `
            SELECT 1
            FROM engine_roster_memberships
            WHERE id = $1::uuid
              AND tournament_id = $2::uuid
              AND team_id = $3::uuid
              AND player_id = $4::uuid
          `,
          [
            player.rosterMembershipId,
            input.tournamentId,
            team.teamId,
            player.playerId
          ]
        );
        if (membership.rows[0] === undefined) {
          throw new EnginePersistenceInvariantError(
            "Revision player does not match the referenced roster history."
          );
        }
      }
    }
  }

  private assertEvents(input: ActivateMatchRevisionInput): void {
    const participantTeamIds = new Set(input.teams.map((team) => team.teamId));
    const participantTeamByPlayerId = new Map<string, string>();
    for (const team of input.teams) {
      for (const player of team.players) {
        const existingTeamId = participantTeamByPlayerId.get(player.playerId);
        if (existingTeamId !== undefined && existingTeamId !== team.teamId) {
          throw new EnginePersistenceInvariantError(
            "A revision player may belong to only one participant team."
          );
        }
        participantTeamByPlayerId.set(player.playerId, team.teamId);
      }
    }
    const sequences = new Set<number>();
    const eventIds = new Set<string>();

    for (const event of input.events) {
      if (event.sequence <= 0 || sequences.has(event.sequence)) {
        throw new EnginePersistenceInvariantError(
          "Revision event sequences must be positive and unique."
        );
      }
      sequences.add(event.sequence);
      if (eventIds.has(event.id)) {
        throw new EnginePersistenceInvariantError(
          "Revision event identifiers must be unique."
        );
      }
      eventIds.add(event.id);
      if (event.teamId !== undefined && !participantTeamIds.has(event.teamId)) {
        throw new EnginePersistenceInvariantError(
          "Scoring events may reference only revision participant teams."
        );
      }
      if (
        event.playerId !== undefined &&
        (event.teamId === undefined ||
          participantTeamByPlayerId.get(event.playerId) !== event.teamId)
      ) {
        throw new EnginePersistenceInvariantError(
          "Scoring event players must belong to the referenced participant team."
        );
      }
      const hasAttempt = event.shotAttempt !== undefined;
      if ((event.type === "shot_attempt") !== hasAttempt) {
        throw new EnginePersistenceInvariantError(
          "Only shot_attempt events may contain a shot attempt payload."
        );
      }
      if (
        event.type === "shot_attempt" &&
        (event.teamId === undefined || event.playerId === undefined)
      ) {
        throw new EnginePersistenceInvariantError(
          "Shot attempts require participant team and player attribution."
        );
      }
      if (
        event.shotAttempt?.classification !== undefined &&
        event.shotAttempt.outcome !== "miss"
      ) {
        throw new EnginePersistenceInvariantError(
          "Guy, Di, Tri, and splash-out may decorate only a miss attempt."
        );
      }
    }
  }

  private async insertEvent(
    executor: EnginePostgresExecutor,
    input: ActivateMatchRevisionInput,
    event: MatchRevisionEventInput
  ): Promise<void> {
    await executor.query(
      `
        INSERT INTO engine_match_events (
          id, tournament_id, revision_id, sequence, event_type, team_id,
          player_id, occurred_at, source_reference, created_at, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid,
          $7::uuid, $8, $9, $10, $11::jsonb
        )
      `,
      [
        event.id,
        input.tournamentId,
        input.revision.id,
        event.sequence,
        event.type,
        event.teamId ?? null,
        event.playerId ?? null,
        event.occurredAt ?? null,
        event.sourceReference ?? null,
        input.revision.createdAt,
        writeEngineJson(event.metadata ?? {})
      ]
    );
    const attempt = event.shotAttempt;
    if (attempt === undefined) {
      return;
    }
    await executor.query(
      `
        INSERT INTO engine_shot_attempts (
          event_id, outcome, cup_delta, phase, turn_number,
          team_turn_order, shot_in_team_turn
        ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
      `,
      [
        event.id,
        attempt.outcome,
        attempt.cupDelta,
        attempt.phase ?? null,
        attempt.turnNumber ?? null,
        attempt.teamTurnOrder ?? null,
        attempt.shotInTeamTurn ?? null
      ]
    );
    if (attempt.classification !== undefined) {
      await executor.query(
        `
          INSERT INTO engine_shot_classifications (event_id, classification)
          VALUES ($1::uuid, $2)
        `,
        [event.id, attempt.classification]
      );
    }
  }
}

function participantKey(row: FrozenPlayerRow): string {
  return [
    row.side_number,
    row.team_id,
    row.player_id,
    row.roster_membership_id ?? "legacy",
    row.roster_slot
  ].join(":");
}

function sourceWriterMode(sourceAdapter: string): ScoringWriterMode {
  switch (sourceAdapter) {
  case "excel_import":
    return "excel_import";
  case "in_app_live":
    return "in_app_live";
  case "operator_correction":
    return "operator_correction";
  default:
    throw new EnginePersistenceInvariantError(
      "Revision source adapter cannot acquire a canonical writer."
    );
  }
}
