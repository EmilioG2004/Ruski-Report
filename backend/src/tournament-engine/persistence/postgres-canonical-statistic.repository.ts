import { PostgresDatabase } from "../../database";
import { TransactionContext } from "../../repositories/transaction";
import {
  calculateCanonicalAggregateStatistics,
  calculateCanonicalMatchStatistics,
  CanonicalStatisticRevision,
  CanonicalStatisticUniverse,
  CanonicalStatisticValue
} from "../statistics";
import { createUuidV5 } from "../scheduling/uuid-v5";
import {
  CanonicalScoringBatchPersistenceInput,
  CanonicalScoringBatchPersistenceResult,
  CanonicalScoringMaterializationInput,
  CanonicalRevisionStatisticRefreshInput,
  CanonicalRevisionStatisticRefreshResult,
  CanonicalStatisticPersistenceContract
} from "./canonical-scoring-contracts";
import { EnginePersistenceInvariantError } from "./errors";
import {
  engineExecutor,
  EnginePostgresExecutor,
  writeEngineJson
} from "./postgres-engine-executor";

interface RevisionRow {
  tournament_id: string;
  match_id: string;
  revision_id: string;
  stage: "pod_play" | "playoffs";
  pod_id: string | null;
}

interface RevisionTeamRow {
  revision_id: string;
  side_number: 1 | 2;
  team_id: string;
}

interface RevisionPlayerRow {
  revision_id: string;
  side_number: 1 | 2;
  team_id: string;
  player_id: string;
  roster_membership_id: string | null;
  roster_slot: number;
}

interface RevisionEventRow {
  revision_id: string;
  event_id: string;
  sequence: number;
  event_type: CanonicalStatisticRevision["events"][number]["type"];
  team_id: string | null;
  player_id: string | null;
  outcome: "make" | "miss" | null;
  classification: "guy" | "di" | "tri" | "splash_out" | null;
  cup_delta: number | null;
}

interface UniverseRow {
  tournament_id: string;
  team_id: string;
  pod_id: string;
  player_id: string | null;
}

export class PostgresCanonicalStatisticRepository
implements CanonicalStatisticPersistenceContract {
  constructor(private readonly database: PostgresDatabase) {}

  async persistMaterializedBatchInTransaction(
    input: CanonicalScoringBatchPersistenceInput,
    transaction: TransactionContext
  ): Promise<CanonicalScoringBatchPersistenceResult> {
    validateInput(input);
    const ordered = [...input.materializations].sort((left, right) =>
      left.matchId.localeCompare(right.matchId)
    );
    const refreshed = await this.refreshActiveRevisionsInTransaction({
      tournamentId: input.tournamentId,
      rulesVersion: input.rulesVersion,
      calculatedAt: input.calculatedAt,
      revisions: ordered.map((item) => ({
        matchId: item.matchId,
        revisionId: item.revisionId
      }))
    }, transaction, true);
    const executor = engineExecutor(this.database, transaction);
    const runByRevisionId = new Map(
      refreshed.matches.map((match) => [
        match.revisionId,
        match.matchStatisticRunId
      ])
    );
    const materialized = [];
    for (const item of ordered) {
      const runId = runByRevisionId.get(item.revisionId);
      if (runId === undefined) {
        throw new EnginePersistenceInvariantError(
          "Canonical statistic refresh omitted a selected revision."
        );
      }
      await this.insertMaterialization(executor, input, item, runId);
      materialized.push({
        matchId: item.matchId,
        revisionId: item.revisionId,
        candidateId: item.candidateId,
        matchStatisticRunId: runId
      });
    }
    return {
      materialized,
      tournamentStatisticRunId: refreshed.tournamentStatisticRunId,
      tournamentStatisticRunDigest: refreshed.tournamentStatisticRunDigest
    };
  }

  async refreshActiveRevisionsInTransaction(
    input: CanonicalRevisionStatisticRefreshInput,
    transaction: TransactionContext,
    allowRevisionHistoryForSameMatch = false
  ): Promise<CanonicalRevisionStatisticRefreshResult> {
    validateRefreshInput(input, allowRevisionHistoryForSameMatch);
    const executor = engineExecutor(this.database, transaction);
    const ordered = [...input.revisions].sort((left, right) =>
      left.matchId.localeCompare(right.matchId)
    );
    const selectedRevisions = await this.readRevisions(
      executor,
      input.tournamentId,
      ordered.map((item) => item.revisionId),
      false
    );
    const selectedById = new Map(
      selectedRevisions.map((revision) => [revision.revisionId, revision])
    );
    const matches = [];

    for (const item of ordered) {
      const revision = selectedById.get(item.revisionId);
      if (revision === undefined || revision.matchId !== item.matchId) {
        throw new EnginePersistenceInvariantError(
          "Canonical statistic materialization requires the active selected revision."
        );
      }
      const calculation = calculateCanonicalMatchStatistics(
        revision,
        input.rulesVersion
      );
      const runId = createUuidV5(
        item.revisionId,
        `canonical-match-statistics-v1:${input.rulesVersion}:${calculation.inputDigest}`
      );
      await this.insertRun(executor, {
        runId,
        tournamentId: input.tournamentId,
        runKind: "match_revision",
        matchId: item.matchId,
        revisionId: item.revisionId,
        inputDigest: calculation.inputDigest,
        rulesVersion: input.rulesVersion,
        createdAt: input.calculatedAt,
        values: calculation.values
      });
      matches.push({
        matchId: item.matchId,
        revisionId: item.revisionId,
        matchStatisticRunId: runId
      });
    }

    const activeRevisions = await this.readRevisions(
      executor,
      input.tournamentId,
      undefined,
      true
    );
    const universe = await this.readUniverse(executor, input.tournamentId);
    const aggregate = calculateCanonicalAggregateStatistics(
      activeRevisions,
      input.rulesVersion,
      universe
    );
    const tournamentRunId = createUuidV5(
      input.tournamentId,
      `canonical-tournament-statistics-v1:${input.rulesVersion}:${aggregate.inputDigest}`
    );
    await this.insertRun(executor, {
      runId: tournamentRunId,
      tournamentId: input.tournamentId,
      runKind: "tournament_aggregate",
      inputDigest: aggregate.inputDigest,
      rulesVersion: input.rulesVersion,
      createdAt: input.calculatedAt,
      values: aggregate.values
    });
    await executor.query(
      `
        INSERT INTO engine_active_tournament_statistic_runs (
          tournament_id, statistic_run_id, rules_version, activated_at
        ) VALUES ($1::uuid, $2::uuid, $3, $4)
        ON CONFLICT (tournament_id) DO UPDATE SET
          statistic_run_id = EXCLUDED.statistic_run_id,
          rules_version = EXCLUDED.rules_version,
          activated_at = EXCLUDED.activated_at
      `,
      [input.tournamentId, tournamentRunId, input.rulesVersion, input.calculatedAt]
    );
    return {
      matches,
      tournamentStatisticRunId: tournamentRunId,
      tournamentStatisticRunDigest: aggregate.inputDigest
    };
  }

  private async readRevisions(
    executor: EnginePostgresExecutor,
    tournamentId: string,
    revisionIds: readonly string[] | undefined,
    requireActive: boolean
  ): Promise<CanonicalStatisticRevision[]> {
    const revisionResult = await executor.query<RevisionRow>(
      `
        SELECT match.tournament_id::text,
               match.id::text AS match_id,
               revision.id::text AS revision_id,
               match.stage,
               match.pod_id::text
        FROM engine_match_revisions revision
        JOIN engine_matches match
          ON match.tournament_id = revision.tournament_id
         AND match.id = revision.match_id
        WHERE match.tournament_id = $1::uuid
          AND ($2::uuid[] IS NULL OR revision.id = ANY($2::uuid[]))
          AND (NOT $3::boolean OR match.active_revision_id = revision.id)
          AND NOT match.identity_only
        ORDER BY match.id, revision.id
      `,
      [tournamentId, revisionIds ?? null, requireActive]
    );
    if (revisionResult.rows.length === 0) {
      return [];
    }
    const ids = revisionResult.rows.map((row) => row.revision_id);
    const teamResult = await executor.query<RevisionTeamRow>(
        `
          SELECT revision_id::text, side_number, team_id::text
          FROM engine_match_revision_teams
          WHERE revision_id = ANY($1::uuid[])
          ORDER BY revision_id, side_number
        `,
        [ids]
      );
    const playerResult = await executor.query<RevisionPlayerRow>(
        `
          SELECT revision_id::text, side_number, team_id::text,
                 player_id::text, roster_membership_id::text, roster_slot
          FROM engine_match_revision_players
          WHERE revision_id = ANY($1::uuid[])
          ORDER BY revision_id, side_number, roster_slot, player_id
        `,
        [ids]
      );
    const eventResult = await executor.query<RevisionEventRow>(
        `
          SELECT event.revision_id::text,
                 event.id::text AS event_id,
                 event.sequence,
                 event.event_type,
                 event.team_id::text,
                 event.player_id::text,
                 attempt.outcome,
                 classification.classification,
                 attempt.cup_delta
          FROM engine_match_events event
          LEFT JOIN engine_shot_attempts attempt ON attempt.event_id = event.id
          LEFT JOIN engine_shot_classifications classification
            ON classification.event_id = event.id
          WHERE event.revision_id = ANY($1::uuid[])
          ORDER BY event.revision_id, event.sequence, event.id
        `,
        [ids]
      );
    return revisionResult.rows.map((row) => mapRevision(
      row,
      teamResult.rows,
      playerResult.rows,
      eventResult.rows
    ));
  }

  private async readUniverse(
    executor: EnginePostgresExecutor,
    tournamentId: string
  ): Promise<CanonicalStatisticUniverse> {
    const result = await executor.query<UniverseRow>(
      `
        SELECT team.tournament_id::text,
               team.id::text AS team_id,
               pod_team.pod_id::text,
               membership.player_id::text
        FROM engine_teams team
        JOIN engine_pod_teams pod_team
          ON pod_team.tournament_id = team.tournament_id
         AND pod_team.team_id = team.id
        LEFT JOIN engine_roster_memberships membership
          ON membership.tournament_id = team.tournament_id
         AND membership.team_id = team.id
         AND membership.closed_at IS NULL
        WHERE team.tournament_id = $1::uuid
        ORDER BY team.id, membership.roster_slot, membership.player_id
      `,
      [tournamentId]
    );
    const teams = new Map<string, { podId: string; playerIds: string[] }>();
    for (const row of result.rows) {
      const team = teams.get(row.team_id) ?? { podId: row.pod_id, playerIds: [] };
      if (team.podId !== row.pod_id) {
        throw new EnginePersistenceInvariantError(
          "Canonical statistic universe found conflicting pod identity."
        );
      }
      if (row.player_id !== null) {
        team.playerIds.push(row.player_id);
      }
      teams.set(row.team_id, team);
    }
    return {
      tournamentId,
      teams: [...teams.entries()].map(([teamId, team]) => ({
        teamId,
        podId: team.podId,
        playerIds: team.playerIds
      }))
    };
  }

  private async insertRun(
    executor: EnginePostgresExecutor,
    input: {
      runId: string;
      tournamentId: string;
      runKind: "match_revision" | "tournament_aggregate";
      matchId?: string;
      revisionId?: string;
      inputDigest: string;
      rulesVersion: number;
      createdAt: string;
      values: readonly CanonicalStatisticValue[];
    }
  ): Promise<void> {
    await executor.query(
      `
        INSERT INTO engine_statistic_runs (
          id, tournament_id, input_digest, rules_version, created_at, metadata
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)
      `,
      [
        input.runId,
        input.tournamentId,
        input.inputDigest,
        input.rulesVersion,
        input.createdAt,
        writeEngineJson({ contract: "canonical-statistics-v1" })
      ]
    );
    await executor.query(
      `
        INSERT INTO engine_canonical_statistic_run_scopes (
          statistic_run_id, tournament_id, run_kind, match_id, revision_id,
          rules_version, created_at, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6, $7, '{}'::jsonb
        )
      `,
      [
        input.runId,
        input.tournamentId,
        input.runKind,
        input.matchId ?? null,
        input.revisionId ?? null,
        input.rulesVersion,
        input.createdAt
      ]
    );
    for (const value of input.values) {
      await this.insertValue(executor, input, value);
    }
  }

  private insertValue(
    executor: EnginePostgresExecutor,
    run: { runId: string; tournamentId: string },
    value: CanonicalStatisticValue
  ): Promise<unknown> {
    const valueId = createUuidV5(run.runId, [
      value.scope,
      value.matchId ?? "none",
      value.podId ?? "none",
      value.stage,
      value.subjectType,
      value.subjectId,
      value.metric
    ].join(":"));
    return executor.query(
      `
        INSERT INTO engine_canonical_statistic_values (
          id, tournament_id, statistic_run_id, scope, match_id, pod_id,
          stage, subject_type, subject_id, metric,
          numerator, denominator, value, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6::uuid,
          $7, $8, $9::uuid, $10,
          $11::numeric, $12::numeric,
          CASE
            WHEN $10 = 'shooting_percentage' AND $12::numeric > 0
              THEN $11::numeric / $12::numeric
            ELSE $13::numeric
          END,
          '{}'::jsonb
        )
      `,
      [
        valueId,
        run.tournamentId,
        run.runId,
        value.scope,
        value.matchId ?? null,
        value.podId ?? null,
        value.stage,
        value.subjectType,
        value.subjectId,
        value.metric,
        value.numerator,
        value.denominator,
        value.value
      ]
    );
  }

  private insertMaterialization(
    executor: EnginePostgresExecutor,
    batch: CanonicalScoringBatchPersistenceInput,
    item: CanonicalScoringMaterializationInput,
    matchStatisticRunId: string
  ): Promise<unknown> {
    return executor.query(
      `
        INSERT INTO engine_workbook_candidate_materializations (
          candidate_id, tournament_id, match_id, revision_id,
          match_statistic_run_id, confirmation_digest, adapter_version,
          rules_version, materialized_by_admin_id, writer_fencing_token,
          materialized_at, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid,
          $5::uuid, $6, $7,
          $8, $9::uuid, $10,
          $11, '{}'::jsonb
        )
      `,
      [
        item.candidateId,
        batch.tournamentId,
        item.matchId,
        item.revisionId,
        matchStatisticRunId,
        item.confirmationDigest,
        item.adapterVersion,
        batch.rulesVersion,
        item.materializedByAdminId,
        item.writerFencingToken,
        item.materializedAt
      ]
    );
  }
}

function mapRevision(
  row: RevisionRow,
  teams: readonly RevisionTeamRow[],
  players: readonly RevisionPlayerRow[],
  events: readonly RevisionEventRow[]
): CanonicalStatisticRevision {
  return {
    tournamentId: row.tournament_id,
    matchId: row.match_id,
    revisionId: row.revision_id,
    stage: row.stage,
    ...(row.pod_id === null ? {} : { podId: row.pod_id }),
    teams: teams
      .filter((team) => team.revision_id === row.revision_id)
      .map((team) => ({
        sideNumber: team.side_number,
        teamId: team.team_id,
        players: players
          .filter((player) =>
            player.revision_id === row.revision_id &&
            player.side_number === team.side_number &&
            player.team_id === team.team_id
          )
          .map((player) => ({
            playerId: player.player_id,
            rosterMembershipId: player.roster_membership_id,
            rosterSlot: player.roster_slot
          }))
      })),
    events: events
      .filter((event) => event.revision_id === row.revision_id)
      .map((event) => ({
        eventId: event.event_id,
        sequence: event.sequence,
        type: event.event_type,
        ...(event.team_id === null ? {} : { teamId: event.team_id }),
        ...(event.player_id === null ? {} : { playerId: event.player_id }),
        ...(event.outcome === null ? {} : {
          shotAttempt: {
            outcome: event.outcome,
            ...(event.classification === null
              ? {}
              : { classification: event.classification }),
            cupDelta: requiredCupDelta(event)
          }
        })
      }))
  };
}

function requiredCupDelta(event: RevisionEventRow): number {
  if (event.cup_delta === null) {
    throw new EnginePersistenceInvariantError(
      "Canonical shot event is missing its cup effect."
    );
  }
  return event.cup_delta;
}

function validateInput(input: CanonicalScoringBatchPersistenceInput): void {
  if (!Number.isSafeInteger(input.rulesVersion) || input.rulesVersion <= 0 ||
      !validTimestamp(input.calculatedAt) || input.materializations.length === 0) {
    throw new EnginePersistenceInvariantError(
      "Canonical scoring persistence input is incomplete."
    );
  }
  const revisions = new Set<string>();
  const candidates = new Set<string>();
  for (const item of input.materializations) {
    if (revisions.has(item.revisionId) || candidates.has(item.candidateId) ||
        !/^[a-f0-9]{64}$/.test(item.confirmationDigest) ||
        !Number.isSafeInteger(item.adapterVersion) || item.adapterVersion <= 0 ||
        !Number.isSafeInteger(item.writerFencingToken) || item.writerFencingToken <= 0 ||
        !validTimestamp(item.materializedAt)) {
      throw new EnginePersistenceInvariantError(
        "Canonical scoring materializations require unique valid provenance."
      );
    }
    revisions.add(item.revisionId);
    candidates.add(item.candidateId);
  }
}

function validateRefreshInput(
  input: CanonicalRevisionStatisticRefreshInput,
  allowRevisionHistoryForSameMatch = false
): void {
  if (!Number.isSafeInteger(input.rulesVersion) || input.rulesVersion <= 0 ||
      !validTimestamp(input.calculatedAt) || input.revisions.length === 0) {
    throw new EnginePersistenceInvariantError(
      "Canonical statistic refresh input is incomplete."
    );
  }
  const matches = new Set<string>();
  const revisions = new Set<string>();
  for (const revision of input.revisions) {
    if ((!allowRevisionHistoryForSameMatch && matches.has(revision.matchId)) ||
        revisions.has(revision.revisionId)) {
      throw new EnginePersistenceInvariantError(
        "Canonical statistic refresh revisions must be unique per match."
      );
    }
    matches.add(revision.matchId);
    revisions.add(revision.revisionId);
  }
}

function validTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}
