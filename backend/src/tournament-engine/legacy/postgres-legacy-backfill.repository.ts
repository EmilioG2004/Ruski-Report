import { PoolClient, QueryResult, QueryResultRow } from "pg";

import { PostgresDatabase } from "../../database/postgres-database";
import { createDigest } from "./legacy-determinism";
import { LegacyBackfillRepository } from "./legacy-backfill.repository";
import {
  CanonicalLegacyBracketMatch,
  CanonicalLegacyBracketSlot,
  CanonicalLegacyMatch,
  CanonicalLegacyMatchRevision,
  LegacyBackfillCounts,
  LegacyBackfillPlan,
  LegacyBackfillRecordedState,
  LegacyBackfillRunRecord
} from "./legacy-backfill.types";

const LEGACY_BACKFILL_TOOL_VERSION = 1;
const BACKFILL_ACTOR = "legacy-backfill-2026";

interface SqlExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<Row>>;
}

interface RecordedStateRow extends QueryResultRow {
  engine_tournament_id: string;
  legacy_tournament_id: string;
  source_snapshot_version: number;
  source_digest: string;
  plan_digest: string;
  mapping_digest: string;
  counts: unknown;
}

interface CheckpointRow extends QueryResultRow {
  id: string;
  status: "running" | "completed" | "failed" | "no_op";
}

interface CountRow extends QueryResultRow {
  tournaments: string;
  teams: string;
  players: string;
  roster_memberships: string;
  pods: string;
  matches: string;
  identity_only_matches: string;
  match_revisions: string;
  match_participants: string;
  standing_calculations: string;
  standings: string;
  pod_finalizations: string;
  seed_calculations: string;
  seeds: string;
  brackets: string;
  bracket_rounds: string;
  bracket_matches: string;
  bracket_slots: string;
  comment_references: string;
  report_references: string;
}

/**
 * Writes additive `engine_*` rows and legacy-to-engine links. It may also add
 * deterministic compatibility `match_identities` for structural bracket nodes
 * that lack a legacy public match identity. Existing legacy rows are never
 * updated or deleted.
 */
export class PostgresLegacyBackfillRepository
implements LegacyBackfillRepository {
  constructor(private readonly database: PostgresDatabase) {}

  findRecordedState(
    legacyTournamentId: string
  ): Promise<LegacyBackfillRecordedState | null> {
    return readRecordedState(this.database, legacyTournamentId);
  }

  async apply(
    plan: LegacyBackfillPlan,
    run: LegacyBackfillRunRecord
  ): Promise<LegacyBackfillRecordedState> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE");
      await lockLegacyTournament(client, plan.legacyTournamentId);

      const existing = await readRecordedState(
        client,
        plan.legacyTournamentId
      );
      if (existing !== null) {
        await client.query("COMMIT");
        return existing;
      }

      const checkpointId = await beginCheckpoint(client, plan, run);
      await writeCanonicalPlan(client, plan, checkpointId);
      const actualCounts = await readCanonicalCounts(
        client,
        plan.tournament.id
      );
      assertCountsMatch(plan.counts, actualCounts);
      await completeCheckpoint(client, checkpointId, plan, run, actualCounts);
      await client.query("COMMIT");

      return stateFromPlan(plan, actualCounts);
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordRun(run: LegacyBackfillRunRecord): Promise<void> {
    if (
      run.sourceSnapshotVersion === undefined ||
      run.sourceDigest === undefined ||
      run.planDigest === undefined ||
      run.mappingDigest === undefined ||
      run.counts === undefined
    ) {
      return;
    }

    const databaseStatus = toDatabaseStatus(run);
    const metadata = runMetadata(run);
    await this.database.query(
      `
        INSERT INTO engine_legacy_backfill_runs (
          id, legacy_tournament_id, source_snapshot_version, tool_version,
          source_digest, status, started_at, completed_at, counts,
          error_summary, metadata
        ) VALUES (
          $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
          $10, $11::jsonb
        )
        ON CONFLICT (
          legacy_tournament_id, source_snapshot_version, tool_version,
          source_digest
        ) DO UPDATE SET
          status = CASE
            WHEN engine_legacy_backfill_runs.status = 'completed'
              THEN 'completed'
            ELSE EXCLUDED.status
          END,
          completed_at = CASE
            WHEN engine_legacy_backfill_runs.status = 'completed'
              THEN engine_legacy_backfill_runs.completed_at
            ELSE EXCLUDED.completed_at
          END,
          counts = CASE
            WHEN engine_legacy_backfill_runs.status = 'completed'
              THEN engine_legacy_backfill_runs.counts
            ELSE EXCLUDED.counts
          END,
          error_summary = CASE
            WHEN engine_legacy_backfill_runs.status = 'completed'
              THEN engine_legacy_backfill_runs.error_summary
            ELSE EXCLUDED.error_summary
          END,
          metadata = engine_legacy_backfill_runs.metadata
            || EXCLUDED.metadata
            || jsonb_build_object(
              'attempts',
              COALESCE(
                engine_legacy_backfill_runs.metadata -> 'attempts',
                '[]'::jsonb
              ) || COALESCE(EXCLUDED.metadata -> 'attempts', '[]'::jsonb)
            )
      `,
      [
        run.runId,
        run.legacyTournamentId,
        run.sourceSnapshotVersion,
        LEGACY_BACKFILL_TOOL_VERSION,
        run.sourceDigest,
        databaseStatus,
        run.startedAt,
        run.completedAt,
        writeJson(run.counts),
        run.issues.map((issue) => issue.code).join(", ") || null,
        writeJson(metadata)
      ]
    );
  }
}

async function readRecordedState(
  executor: SqlExecutor,
  legacyTournamentId: string
): Promise<LegacyBackfillRecordedState | null> {
  const result = await executor.query<RecordedStateRow>(
    `
      SELECT link.engine_tournament_id,
             run.legacy_tournament_id,
             run.source_snapshot_version,
             run.source_digest,
             run.metadata ->> 'planDigest' AS plan_digest,
             run.metadata ->> 'mappingDigest' AS mapping_digest,
             run.counts
      FROM engine_legacy_tournament_links link
      JOIN engine_legacy_backfill_runs run ON run.id = link.backfill_run_id
      WHERE link.legacy_tournament_id = $1
        AND run.status = 'completed'
      ORDER BY run.completed_at DESC, run.id DESC
      LIMIT 1
    `,
    [legacyTournamentId]
  );
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }
  if (row.plan_digest === null || row.mapping_digest === null) {
    throw new Error("Legacy backfill checkpoint digests are incomplete.");
  }
  const recordedCounts = readCounts(row.counts);
  const actualCounts = await readCanonicalCounts(
    executor,
    row.engine_tournament_id
  );
  assertCountsMatch(recordedCounts, actualCounts);
  return {
    legacyTournamentId: row.legacy_tournament_id,
    sourceSnapshotVersion: Number(row.source_snapshot_version),
    sourceDigest: row.source_digest,
    planDigest: row.plan_digest,
    mappingDigest: row.mapping_digest,
    counts: actualCounts
  };
}

async function lockLegacyTournament(
  executor: SqlExecutor,
  legacyTournamentId: string
): Promise<void> {
  await executor.query(
    `
      SELECT pg_advisory_xact_lock(
        hashtextextended('engine:legacy-backfill:' || $1::text, 0)
      )
    `,
    [legacyTournamentId]
  );
}

async function beginCheckpoint(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan,
  run: LegacyBackfillRunRecord
): Promise<string> {
  const existing = await executor.query<CheckpointRow>(
    `
      SELECT id, status
      FROM engine_legacy_backfill_runs
      WHERE legacy_tournament_id = $1
        AND source_snapshot_version = $2
        AND tool_version = $3
        AND source_digest = $4
      FOR UPDATE
    `,
    [
      plan.legacyTournamentId,
      plan.sourceSnapshotVersion,
      LEGACY_BACKFILL_TOOL_VERSION,
      plan.sourceDigest
    ]
  );
  const checkpoint = existing.rows[0];
  if (checkpoint?.status === "completed") {
    throw new Error(
      "Completed backfill checkpoint exists without its tournament link."
    );
  }

  if (checkpoint !== undefined) {
    await executor.query(
      `
        UPDATE engine_legacy_backfill_runs
        SET status = 'running',
            started_at = $2,
            completed_at = NULL,
            counts = $3::jsonb,
            error_summary = NULL,
            metadata = metadata || $4::jsonb
              || jsonb_build_object(
                'attempts',
                COALESCE(metadata -> 'attempts', '[]'::jsonb)
                  || ($4::jsonb -> 'attempts')
              )
        WHERE id = $1::uuid
      `,
      [checkpoint.id, run.startedAt, writeJson(plan.counts), writeJson(runMetadata(run))]
    );
    return checkpoint.id;
  }

  await executor.query(
    `
      INSERT INTO engine_legacy_backfill_runs (
        id, legacy_tournament_id, source_snapshot_version, tool_version,
        source_digest, status, started_at, counts, metadata
      ) VALUES (
        $1::uuid, $2, $3, $4, $5, 'running', $6, $7::jsonb, $8::jsonb
      )
    `,
    [
      run.runId,
      plan.legacyTournamentId,
      plan.sourceSnapshotVersion,
      LEGACY_BACKFILL_TOOL_VERSION,
      plan.sourceDigest,
      run.startedAt,
      writeJson(plan.counts),
      writeJson(runMetadata(run))
    ]
  );
  return run.runId;
}

async function completeCheckpoint(
  executor: SqlExecutor,
  checkpointId: string,
  plan: LegacyBackfillPlan,
  run: LegacyBackfillRunRecord,
  counts: LegacyBackfillCounts
): Promise<void> {
  await executor.query(
    `
      UPDATE engine_legacy_backfill_runs
      SET status = 'completed',
          completed_at = $2,
          counts = $3::jsonb,
          error_summary = NULL,
          metadata = metadata || $4::jsonb
      WHERE id = $1::uuid
    `,
    [
      checkpointId,
      run.completedAt,
      writeJson(counts),
      writeJson({
        outcomeStatus: "applied",
        planDigest: plan.planDigest,
        mappingDigest: plan.mappingDigest,
        schemaVersion: plan.schemaVersion
      })
    ]
  );
}

async function writeCanonicalPlan(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan,
  checkpointId: string
): Promise<void> {
  await writeTournament(executor, plan);
  await writeTeamsPlayersPods(executor, plan);
  await transitionLegacyTournament(executor, plan);
  await writeMatchesAndRevisions(executor, plan);
  await writeStandingsAndSeeds(executor, plan);
  await writeBracket(executor, plan);
  await writeLegacyLinks(executor, plan, checkpointId);
}

async function writeTournament(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan
): Promise<void> {
  const tournament = plan.tournament;
  await executor.query(
    `
      INSERT INTO engine_tournaments (
        id, public_key, game_type, year, name, lifecycle, visibility,
        setup_published_at, created_at, updated_at, metadata
      ) VALUES (
        $1::uuid, $2, $3, $4, $5, 'draft_setup', 'private',
        NULL, $6, $6, $7::jsonb
      )
    `,
    [
      tournament.id,
      tournament.publicKey,
      tournament.gameType,
      tournament.year,
      tournament.name,
      plan.sourceSnapshotPublishedAt,
      writeJson({
        legacyTournamentId: tournament.legacyTournamentId,
        sourceSnapshotVersion: plan.sourceSnapshotVersion,
        legacyFormat: tournament.format,
        backfilled: true
      })
    ]
  );

  const configuration = tournament.configuration;
  await executor.query(
    `
      INSERT INTO engine_tournament_configurations (
        tournament_id, format_version, format_type, team_count, pod_count,
        pod_sizes, players_per_team, games_per_pair, qualifiers_per_pod,
        bracket_size, allow_byes, standings_rules, locked_at, metadata
      ) VALUES (
        $1::uuid, $2, $3, $4, $5, $6::smallint[], $7, $8, $9,
        $10, $11, $12::text[], $13, $14::jsonb
      )
    `,
    [
      tournament.id,
      configuration.formatVersion,
      configuration.formatType,
      configuration.teamCount,
      configuration.podCount,
      configuration.podSizes,
      configuration.playersPerTeam,
      configuration.gamesPerPair,
      configuration.qualifiersPerPod,
      configuration.bracketSize,
      configuration.allowByes,
      configuration.standingsRules,
      plan.sourceSnapshotPublishedAt,
      writeJson({ legacyBackfill: true })
    ]
  );
}

async function transitionLegacyTournament(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan
): Promise<void> {
  const result = await executor.query(
    `
      UPDATE engine_tournaments
      SET lifecycle = $2,
          visibility = $3,
          setup_published_at = $4,
          updated_at = $4,
          row_version = row_version + 1
      WHERE id = $1::uuid AND lifecycle = 'draft_setup'
      RETURNING id
    `,
    [
      plan.tournament.id,
      plan.tournament.lifecycle,
      plan.tournament.visibility,
      plan.sourceSnapshotPublishedAt
    ]
  );
  if (result.rowCount !== 1) {
    throw new Error("Legacy tournament setup could not be atomically published.");
  }
}

async function writeTeamsPlayersPods(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan
): Promise<void> {
  const tournamentId = plan.tournament.id;
  for (const pod of plan.pods) {
    await executor.query(
      `
        INSERT INTO engine_pods (
          id, tournament_id, public_key, name, normalized_name, sequence,
          metadata
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        pod.id,
        tournamentId,
        pod.publicKey,
        pod.name,
        normalizeName(pod.name),
        pod.sequence,
        writeJson({ legacyPodId: pod.legacyPodId })
      ]
    );
  }
  for (const team of plan.teams) {
    await executor.query(
      `
        INSERT INTO engine_teams (
          id, tournament_id, public_key, name, normalized_name, sequence,
          metadata
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        team.id,
        tournamentId,
        team.publicKey,
        team.name,
        normalizeName(team.name),
        team.sequence,
        writeJson({ legacyTeamId: team.legacyTeamId })
      ]
    );
  }
  for (const player of plan.players) {
    await executor.query(
      `
        INSERT INTO engine_players (
          id, tournament_id, public_key, display_name, created_at, metadata
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)
      `,
      [
        player.id,
        tournamentId,
        player.publicKey,
        player.displayName,
        plan.sourceSnapshotPublishedAt,
        writeJson({ legacyPlayerId: player.legacyPlayerId })
      ]
    );
  }
  for (const membership of plan.rosterMemberships) {
    await executor.query(
      `
        INSERT INTO engine_roster_memberships (
          id, tournament_id, public_key, team_id, player_id, roster_slot,
          opened_at, opened_by, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6, $7, $8,
          $9::jsonb
        )
      `,
      [
        membership.id,
        tournamentId,
        membership.publicKey,
        membership.teamId,
        membership.playerId,
        membership.sequence,
        membership.effectiveFrom,
        BACKFILL_ACTOR,
        writeJson({
          legacyTeamId: membership.legacyTeamId,
          legacyPlayerId: membership.legacyPlayerId
        })
      ]
    );
  }
  const teamsById = new Map(plan.teams.map((team) => [team.id, team]));
  for (const pod of plan.pods) {
    for (const [index, teamId] of pod.teamIds.entries()) {
      const team = requireMapValue(teamsById, teamId);
      await executor.query(
        `
          INSERT INTO engine_pod_teams (
            tournament_id, pod_id, team_id, initial_seed, assigned_at
          ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
        `,
        [
          tournamentId,
          pod.id,
          teamId,
          team.initialPodSeed ?? index + 1,
          plan.sourceSnapshotPublishedAt
        ]
      );
    }
  }
}

async function writeMatchesAndRevisions(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan
): Promise<void> {
  const tournamentId = plan.tournament.id;
  for (const match of plan.matches.filter(
    (candidate) => candidate.legacyMatchId === undefined
  )) {
    await executor.query(
      `
        INSERT INTO match_identities (match_id, tournament_id, created_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (match_id) DO NOTHING
      `,
      [
        match.publicKey,
        plan.tournament.publicKey,
        plan.sourceSnapshotPublishedAt
      ]
    );
    const identity = await executor.query<{ tournament_id: string }>(
      `SELECT tournament_id FROM match_identities WHERE match_id = $1`,
      [match.publicKey]
    );
    if (identity.rows[0]?.tournament_id !== plan.tournament.publicKey) {
      throw new Error(
        "Synthesized compatibility match identity belongs to another tournament."
      );
    }
  }
  for (const match of plan.matches) {
    await executor.query(
      `
        INSERT INTO engine_matches (
          id, tournament_id, public_key, stage, pod_id, sequence,
          identity_only, status, score_availability, created_at, updated_at,
          metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4, $5::uuid, $6,
          $7, $8, $9, $10, $10, $11::jsonb
        )
      `,
      [
        match.id,
        tournamentId,
        match.publicKey,
        match.stage,
        match.podId ?? null,
        match.sequence ?? null,
        match.identityOnly,
        match.status ?? null,
        match.scoreAvailability,
        plan.sourceSnapshotPublishedAt,
        writeJson({
          legacyMatchId: match.legacyMatchId,
          legacyBracketMatchId: match.legacyBracketMatchId,
          canonicalBracketMatchId: match.bracketMatchId,
          sourceSnapshotBacked: match.sourceSnapshotBacked,
          compatibilityIdentity: match.legacyMatchId === undefined
        })
      ]
    );
  }

  const matchesById = new Map(plan.matches.map((match) => [match.id, match]));
  const membershipsByTeamPlayer = new Map(
    plan.rosterMemberships.map((membership) => [
      `${membership.teamId}:${membership.playerId}`,
      membership
    ])
  );
  await writeMatchSlots(executor, plan);
  for (const revision of plan.matchRevisions) {
    const match = requireMapValue(matchesById, revision.matchId);
    await writeRevision(executor, plan, match, revision, membershipsByTeamPlayer);
  }
}

async function writeRevision(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan,
  match: CanonicalLegacyMatch,
  revision: CanonicalLegacyMatchRevision,
  membershipsByTeamPlayer: ReadonlyMap<
    string,
    LegacyBackfillPlan["rosterMemberships"][number]
  >
): Promise<void> {
  const tournamentId = plan.tournament.id;
  await executor.query(
    `
      INSERT INTO engine_match_revisions (
        id, tournament_id, match_id, public_key, revision_number, status,
        score_availability, reason, source_adapter, source_reference,
        actor_id, confirmation_digest, created_at, metadata
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7,
        'legacy_backfill', 'legacy_backfill', $8, $9, $10, $11, $12::jsonb
      )
    `,
    [
      revision.id,
      tournamentId,
      revision.matchId,
      revision.publicKey,
      revision.revisionNumber,
      match.status,
      match.scoreAvailability,
      revision.legacyMatchId === undefined
        ? `legacy-bracket:${match.legacyBracketMatchId}`
        : `legacy-match:${revision.legacyMatchId}@${revision.sourceSnapshotVersion}`,
      BACKFILL_ACTOR,
      createDigest(revision),
      revision.sourceUpdatedAt,
      writeJson({
        sourceSnapshotVersion: revision.sourceSnapshotVersion,
        winnerTeamId: revision.winnerTeamId,
        isFinal: revision.isFinal
      })
    ]
  );

  const scoreByTeam = new Map(
    revision.scores.map((score) => [score.teamId, score.score])
  );
  for (const [index, participant] of revision.participants.entries()) {
    const sideNumber = index + 1;
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
        tournamentId,
        revision.id,
        sideNumber,
        participant.teamId,
        participant.score ?? scoreByTeam.get(participant.teamId) ?? null,
        revisionTeamResult(match, revision, participant.teamId, participant.result),
        requireTeam(plan, participant.teamId).name,
        writeJson({ seed: participant.seed })
      ]
    );
    for (const [playerIndex, playerId] of participant.playerIds.entries()) {
      const membership = membershipsByTeamPlayer.get(
        `${participant.teamId}:${playerId}`
      );
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
          tournamentId,
          revision.id,
          sideNumber,
          participant.teamId,
          playerId,
          membership?.id ?? null,
          playerIndex + 1,
          requirePlayer(plan, playerId).displayName,
          writeJson({ legacyBackfill: true })
        ]
      );
    }
  }
  await executor.query(
    `
      UPDATE engine_matches
      SET active_revision_id = $3::uuid,
          participants_frozen_at = $4,
          updated_at = $4
      WHERE tournament_id = $1::uuid AND id = $2::uuid
    `,
    [tournamentId, match.id, revision.id, revision.sourceUpdatedAt]
  );
}

async function writeMatchSlots(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan
): Promise<void> {
  const tournamentId = plan.tournament.id;
  const revisionsByMatch = new Map(
    plan.matchRevisions.map((revision) => [revision.matchId, revision])
  );
  const bracketMatches = flattenBracketMatches(plan);
  const bracketByEngineMatch = new Map(
    bracketMatches.map((match) => [match.matchId, match])
  );
  const engineMatchByBracketMatch = new Map(
    bracketMatches.map((match) => [match.id, match.matchId])
  );

  for (const match of plan.matches.filter((candidate) => !candidate.identityOnly)) {
    const bracketMatch = bracketByEngineMatch.get(match.id);
    if (bracketMatch !== undefined) {
      for (const slot of bracketMatch.slots) {
        await insertEngineMatchSlot(
          executor,
          tournamentId,
          match.id,
          slot,
          engineMatchByBracketMatch
        );
      }
      continue;
    }
    const revision = revisionsByMatch.get(match.id);
    for (const [index, participant] of (revision?.participants ?? []).entries()) {
      await executor.query(
        `
          INSERT INTO engine_match_slots (
            tournament_id, match_id, slot_number, source_type, team_id,
            metadata
          ) VALUES ($1::uuid, $2::uuid, $3, 'team', $4::uuid, $5::jsonb)
        `,
        [
          tournamentId,
          match.id,
          index + 1,
          participant.teamId,
          writeJson({ seed: participant.seed })
        ]
      );
    }
  }
}

async function insertEngineMatchSlot(
  executor: SqlExecutor,
  tournamentId: string,
  matchId: string,
  slot: CanonicalLegacyBracketSlot,
  engineMatchByBracketMatch: ReadonlyMap<string, string>
): Promise<void> {
  const sourceType = bracketSourceType(slot);
  const sourceMatchId = slot.sourceBracketMatchId === undefined
    ? undefined
    : requireMapValue(engineMatchByBracketMatch, slot.sourceBracketMatchId);
  await executor.query(
    `
      INSERT INTO engine_match_slots (
        tournament_id, match_id, slot_number, source_type, team_id,
        source_match_id, seed, metadata
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4, $5::uuid, $6::uuid, $7, $8::jsonb
      )
    `,
    [
      tournamentId,
      matchId,
      slot.sequence,
      sourceType,
      slot.teamId ?? null,
      sourceMatchId ?? null,
      slot.seed ?? null,
      writeJson({ label: slot.label })
    ]
  );
}

async function writeStandingsAndSeeds(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan
): Promise<void> {
  const tournamentId = plan.tournament.id;
  for (const calculation of plan.standingCalculations) {
    await executor.query(
      `
        INSERT INTO engine_standing_calculations (
          id, tournament_id, scope, pod_id, input_digest, rules_version,
          status, calculation_input, created_at, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4::uuid, $5, 1,
          'finalizable', $6::jsonb, $7, $8::jsonb
        )
      `,
      [
        calculation.id,
        tournamentId,
        calculation.scope,
        calculation.podId ?? null,
        calculation.inputDigest,
        writeJson({ standingIds: calculation.standingIds }),
        plan.sourceSnapshotPublishedAt,
        writeJson({ source: "legacy_backfill" })
      ]
    );
  }
  const seededTeamIds = new Set(
    plan.seeds.filter((seed) => seed.qualified).map((seed) => seed.teamId)
  );
  for (const standing of plan.standings) {
    await executor.query(
      `
        INSERT INTO engine_standing_rows (
          id, tournament_id, calculation_id, team_id, public_key, rank,
          wins, losses, cup_differential, makes, attempts,
          shooting_percentage, qualified, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6,
          $7, $8, $9, $10, $11, $12, $13, $14::jsonb
        )
      `,
      [
        standing.id,
        tournamentId,
        standing.calculationId,
        standing.teamId,
        standing.publicKey,
        standing.rank,
        standing.wins,
        standing.losses,
        metricInteger(standing.metricValues, "cupDifferential") ?? 0,
        metricInteger(standing.metricValues, "makes"),
        metricInteger(standing.metricValues, "attempts"),
        metricNumber(standing.metricValues, "shootingPercentage"),
        seededTeamIds.has(standing.teamId),
        writeJson({
          legacyStandingId: standing.legacyStandingId,
          gamesPlayed: standing.gamesPlayed,
          points: standing.points,
          metricValues: standing.metricValues
        })
      ]
    );
  }
  for (const finalization of plan.podFinalizations) {
    await executor.query(
      `
        INSERT INTO engine_pod_finalizations (
          id, tournament_id, pod_id, calculation_id, finalized_by,
          reason, finalized_at, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
          'Completed legacy 2026 snapshot backfill', $6, $7::jsonb
        )
      `,
      [
        finalization.id,
        tournamentId,
        finalization.podId,
        finalization.calculationId,
        BACKFILL_ACTOR,
        plan.sourceSnapshotPublishedAt,
        writeJson({ source: "legacy_backfill" })
      ]
    );
    await executor.query(
      `
        UPDATE engine_pods
        SET active_finalization_id = $3::uuid
        WHERE tournament_id = $1::uuid AND id = $2::uuid
      `,
      [tournamentId, finalization.podId, finalization.id]
    );
  }

  if (plan.seedCalculation !== undefined) {
    await executor.query(
      `
        INSERT INTO engine_seed_calculations (
          id, tournament_id, input_digest, rules_version, created_at, metadata
        ) VALUES ($1::uuid, $2::uuid, $3, 1, $4, $5::jsonb)
      `,
      [
        plan.seedCalculation.id,
        tournamentId,
        plan.seedCalculation.inputDigest,
        plan.sourceSnapshotPublishedAt,
        writeJson({ source: "legacy_backfill" })
      ]
    );
    for (const seed of plan.seeds) {
      const calculatedSeed = requirePositive(seed.calculatedPlayoffSeed);
      const effectiveSeed = requirePositive(seed.effectivePlayoffSeed);
      await executor.query(
        `
          INSERT INTO engine_seed_rows (
            id, tournament_id, calculation_id, team_id, public_key,
            calculated_seed, qualified, metadata
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8::jsonb
          )
        `,
        [
          seed.id,
          tournamentId,
          plan.seedCalculation.id,
          seed.teamId,
          seed.publicKey,
          calculatedSeed,
          seed.qualified,
          writeJson({ legacySeedKey: seed.legacySeedKey })
        ]
      );
      if (seed.qualified) {
        await executor.query(
        `
          INSERT INTO engine_effective_seeds (
            tournament_id, team_id, calculated_seed, effective_seed,
            updated_at
          ) VALUES ($1::uuid, $2::uuid, $3, $4, $5)
        `,
        [
          tournamentId,
          seed.teamId,
          calculatedSeed,
          effectiveSeed,
          plan.sourceSnapshotPublishedAt
        ]
        );
      }
    }
  }
}

async function writeBracket(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan
): Promise<void> {
  const bracket = plan.bracket;
  if (bracket === undefined) {
    return;
  }
  const tournamentId = plan.tournament.id;
  const bracketMatches = bracket.rounds.flatMap((round) => round.matches);
  const completed = bracketMatches.every((match) => match.status === "completed");
  await executor.query(
    `
      INSERT INTO engine_brackets (
        id, tournament_id, public_key, name, bracket_size, placement_policy,
        status, published_at, created_at, metadata
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4, $5, 'standard_mirrored_seeded',
        $6, $7, $7, $8::jsonb
      )
    `,
    [
      bracket.id,
      tournamentId,
      bracket.publicKey,
      bracket.name,
      plan.tournament.configuration.bracketSize,
      completed ? "completed" : "published",
      plan.sourceSnapshotPublishedAt,
      writeJson({ legacyBracketId: bracket.legacyBracketId })
    ]
  );
  for (const round of bracket.rounds) {
    await executor.query(
      `
        INSERT INTO engine_bracket_rounds (
          id, tournament_id, bracket_id, public_key, name, sequence, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb
        )
      `,
      [
        round.id,
        tournamentId,
        bracket.id,
        round.publicKey,
        round.name,
        round.sequence,
        writeJson({ legacyRoundId: round.legacyRoundId })
      ]
    );
    for (const match of round.matches) {
      await writeBracketMatch(executor, plan, bracket.id, round.id, match);
    }
  }
}

async function writeBracketMatch(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan,
  bracketId: string,
  roundId: string,
  match: CanonicalLegacyBracketMatch
): Promise<void> {
  const tournamentId = plan.tournament.id;
  await executor.query(
    `
      INSERT INTO engine_bracket_matches (
        id, tournament_id, bracket_id, round_id, match_id, public_key,
        sequence, metadata
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8::jsonb
      )
    `,
    [
      match.id,
      tournamentId,
      bracketId,
      roundId,
      match.matchId,
      match.publicKey,
      match.sequence,
      writeJson({
        legacyBracketMatchId: match.legacyBracketMatchId,
        status: match.status,
        winnerTeamId: match.winnerTeamId
      })
    ]
  );
  for (const slot of match.slots) {
    await executor.query(
      `
        INSERT INTO engine_bracket_slots (
          id, tournament_id, bracket_match_id, public_key, slot_number,
          source_type, team_id, source_bracket_match_id, seed, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5,
          $6, $7::uuid, $8::uuid, $9, $10::jsonb
        )
      `,
      [
        slot.id,
        tournamentId,
        match.id,
        slot.publicKey,
        slot.sequence,
        bracketSourceType(slot),
        slot.teamId ?? null,
        slot.sourceBracketMatchId ?? null,
        slot.seed ?? null,
        writeJson({ label: slot.label })
      ]
    );
  }
}

async function writeLegacyLinks(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan,
  checkpointId: string
): Promise<void> {
  const tournamentId = plan.tournament.id;
  const common = [
    tournamentId,
    plan.legacyTournamentId,
    plan.sourceSnapshotVersion,
    checkpointId
  ] as const;
  await executor.query(
    `
      INSERT INTO engine_legacy_tournament_links (
        engine_tournament_id, legacy_tournament_id, source_snapshot_version,
        backfill_run_id
      ) VALUES ($1::uuid, $2, $3, $4::uuid)
    `,
    common
  );
  for (const team of plan.teams) {
    await executor.query(
      `
        INSERT INTO engine_legacy_team_links (
          engine_team_id, engine_tournament_id, legacy_tournament_id,
          source_snapshot_version, legacy_team_id, backfill_run_id
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
      `,
      [team.id, ...common.slice(0, 3), team.legacyTeamId, checkpointId]
    );
  }
  for (const player of plan.players) {
    await executor.query(
      `
        INSERT INTO engine_legacy_player_links (
          engine_player_id, engine_tournament_id, legacy_tournament_id,
          source_snapshot_version, legacy_player_id, backfill_run_id
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
      `,
      [player.id, ...common.slice(0, 3), player.legacyPlayerId, checkpointId]
    );
  }
  for (const membership of plan.rosterMemberships) {
    await executor.query(
      `
        INSERT INTO engine_legacy_roster_membership_links (
          engine_roster_membership_id, engine_tournament_id,
          legacy_tournament_id, source_snapshot_version, legacy_team_id,
          legacy_player_id, legacy_sequence, backfill_run_id
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid
        )
      `,
      [
        membership.id,
        ...common.slice(0, 3),
        membership.legacyTeamId,
        membership.legacyPlayerId,
        membership.sequence,
        checkpointId
      ]
    );
  }
  for (const pod of plan.pods) {
    await executor.query(
      `
        INSERT INTO engine_legacy_pod_links (
          engine_pod_id, engine_tournament_id, legacy_tournament_id,
          source_snapshot_version, legacy_pod_id, backfill_run_id
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
      `,
      [pod.id, ...common.slice(0, 3), pod.legacyPodId, checkpointId]
    );
  }
  for (const reference of plan.identityReferences) {
    const match = requireMatch(plan, reference.canonicalMatchId);
    await executor.query(
      `
        INSERT INTO engine_legacy_match_links (
          engine_match_id, engine_tournament_id, legacy_tournament_id,
          source_snapshot_version, legacy_match_id, backfill_run_id
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4, $5, $6::uuid
        )
      `,
      [
        match.id,
        tournamentId,
        plan.legacyTournamentId,
        match.sourceSnapshotBacked ? plan.sourceSnapshotVersion : null,
        reference.legacyMatchId,
        checkpointId
      ]
    );
  }
  for (const revision of plan.matchRevisions.filter(
    (candidate) => candidate.legacyMatchId !== undefined
  )) {
    await executor.query(
      `
        INSERT INTO engine_legacy_match_revision_links (
          engine_match_revision_id, engine_tournament_id, engine_match_id,
          legacy_tournament_id, source_snapshot_version, legacy_match_id,
          backfill_run_id
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid
        )
      `,
      [
        revision.id,
        tournamentId,
        revision.matchId,
        plan.legacyTournamentId,
        plan.sourceSnapshotVersion,
        revision.legacyMatchId,
        checkpointId
      ]
    );
  }
  for (const standing of plan.standings) {
    await executor.query(
      `
        INSERT INTO engine_legacy_standing_links (
          engine_standing_row_id, engine_tournament_id,
          legacy_tournament_id, source_snapshot_version,
          legacy_standing_id, backfill_run_id
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
      `,
      [
        standing.id,
        ...common.slice(0, 3),
        standing.legacyStandingId,
        checkpointId
      ]
    );
  }
  for (const seed of plan.seeds) {
    await executor.query(
      `
        INSERT INTO engine_legacy_seed_links (
          engine_seed_row_id, engine_tournament_id, legacy_tournament_id,
          source_snapshot_version, legacy_team_id, legacy_seed_key,
          backfill_run_id
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid
        )
      `,
      [
        seed.id,
        ...common.slice(0, 3),
        seed.legacyTeamId,
        seed.legacySeedKey,
        checkpointId
      ]
    );
  }
  await writeBracketLinks(executor, plan, checkpointId);
}

async function writeBracketLinks(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan,
  checkpointId: string
): Promise<void> {
  const bracket = plan.bracket;
  if (bracket === undefined) {
    return;
  }
  const common = [
    plan.tournament.id,
    plan.legacyTournamentId,
    plan.sourceSnapshotVersion,
    checkpointId
  ] as const;
  await executor.query(
    `
      INSERT INTO engine_legacy_bracket_root_links (
        engine_bracket_id, engine_tournament_id, legacy_tournament_id,
        source_snapshot_version, legacy_bracket_id, backfill_run_id
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
    `,
    [bracket.id, ...common.slice(0, 3), bracket.legacyBracketId, checkpointId]
  );
  for (const round of bracket.rounds) {
    await executor.query(
      `
        INSERT INTO engine_legacy_bracket_round_links (
          engine_bracket_round_id, engine_tournament_id,
          legacy_tournament_id, source_snapshot_version, legacy_round_id,
          backfill_run_id
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
      `,
      [round.id, ...common.slice(0, 3), round.legacyRoundId, checkpointId]
    );
    for (const match of round.matches) {
      await executor.query(
        `
          INSERT INTO engine_legacy_bracket_match_links (
            engine_bracket_match_id, engine_tournament_id,
            legacy_tournament_id, source_snapshot_version,
            legacy_bracket_match_id, backfill_run_id
          ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
        `,
        [
          match.id,
          ...common.slice(0, 3),
          match.legacyBracketMatchId,
          checkpointId
        ]
      );
      for (const slot of match.slots) {
        const legacySlotKey = `${match.legacyBracketMatchId}:${slot.sequence}`;
        await executor.query(
          `
            INSERT INTO engine_legacy_bracket_slot_links (
              engine_bracket_slot_id, engine_tournament_id,
              legacy_tournament_id, source_snapshot_version,
              legacy_bracket_match_id, legacy_slot_sequence,
              legacy_slot_key, backfill_run_id
            ) VALUES (
              $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid
            )
          `,
          [
            slot.id,
            ...common.slice(0, 3),
            match.legacyBracketMatchId,
            slot.sequence,
            legacySlotKey,
            checkpointId
          ]
        );
      }
    }
  }
}

async function readCanonicalCounts(
  executor: SqlExecutor,
  engineTournamentId: string
): Promise<LegacyBackfillCounts> {
  const result = await executor.query<CountRow>(
    `
      SELECT
        (SELECT count(*) FROM engine_tournaments WHERE id = $1::uuid)
          AS tournaments,
        (SELECT count(*) FROM engine_teams WHERE tournament_id = $1::uuid)
          AS teams,
        (SELECT count(*) FROM engine_players WHERE tournament_id = $1::uuid)
          AS players,
        (SELECT count(*) FROM engine_roster_memberships
          WHERE tournament_id = $1::uuid) AS roster_memberships,
        (SELECT count(*) FROM engine_pods WHERE tournament_id = $1::uuid)
          AS pods,
        (SELECT count(*) FROM engine_matches WHERE tournament_id = $1::uuid)
          AS matches,
        (SELECT count(*) FROM engine_matches
          WHERE tournament_id = $1::uuid AND identity_only)
          AS identity_only_matches,
        (SELECT count(*) FROM engine_match_revisions
          WHERE tournament_id = $1::uuid) AS match_revisions,
        (SELECT count(*) FROM engine_match_revision_teams
          WHERE tournament_id = $1::uuid) AS match_participants,
        (SELECT count(*) FROM engine_standing_calculations
          WHERE tournament_id = $1::uuid) AS standing_calculations,
        (SELECT count(*) FROM engine_standing_rows
          WHERE tournament_id = $1::uuid) AS standings,
        (SELECT count(*) FROM engine_pod_finalizations
          WHERE tournament_id = $1::uuid) AS pod_finalizations,
        (SELECT count(*) FROM engine_seed_calculations
          WHERE tournament_id = $1::uuid) AS seed_calculations,
        (SELECT count(*) FROM engine_seed_rows
          WHERE tournament_id = $1::uuid) AS seeds,
        (SELECT count(*) FROM engine_brackets
          WHERE tournament_id = $1::uuid) AS brackets,
        (SELECT count(*) FROM engine_bracket_rounds
          WHERE tournament_id = $1::uuid) AS bracket_rounds,
        (SELECT count(*) FROM engine_bracket_matches
          WHERE tournament_id = $1::uuid) AS bracket_matches,
        (SELECT count(*) FROM engine_bracket_slots
          WHERE tournament_id = $1::uuid) AS bracket_slots,
        (SELECT count(*) FROM comments comment
          JOIN engine_legacy_match_links link
            ON link.legacy_match_id = comment.match_id
          WHERE link.engine_tournament_id = $1::uuid) AS comment_references,
        (SELECT count(*) FROM comment_reports report
          JOIN engine_legacy_match_links link
            ON link.legacy_match_id = report.match_id
          WHERE link.engine_tournament_id = $1::uuid) AS report_references
    `,
    [engineTournamentId]
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Canonical legacy count verification returned no row.");
  }
  return {
    tournaments: Number(row.tournaments),
    teams: Number(row.teams),
    players: Number(row.players),
    rosterMemberships: Number(row.roster_memberships),
    pods: Number(row.pods),
    matches: Number(row.matches),
    identityOnlyMatches: Number(row.identity_only_matches),
    matchRevisions: Number(row.match_revisions),
    matchParticipants: Number(row.match_participants),
    standingCalculations: Number(row.standing_calculations),
    standings: Number(row.standings),
    podFinalizations: Number(row.pod_finalizations),
    seedCalculations: Number(row.seed_calculations),
    seeds: Number(row.seeds),
    brackets: Number(row.brackets),
    bracketRounds: Number(row.bracket_rounds),
    bracketMatches: Number(row.bracket_matches),
    bracketSlots: Number(row.bracket_slots),
    commentReferences: Number(row.comment_references),
    reportReferences: Number(row.report_references)
  };
}

function assertCountsMatch(
  expected: LegacyBackfillCounts,
  actual: LegacyBackfillCounts
): void {
  for (const key of Object.keys(expected) as Array<keyof LegacyBackfillCounts>) {
    if (expected[key] !== actual[key]) {
      throw new Error(
        `Canonical verification count '${key}' did not match the plan.`
      );
    }
  }
}

function stateFromPlan(
  plan: LegacyBackfillPlan,
  counts: LegacyBackfillCounts
): LegacyBackfillRecordedState {
  return {
    legacyTournamentId: plan.legacyTournamentId,
    sourceSnapshotVersion: plan.sourceSnapshotVersion,
    sourceDigest: plan.sourceDigest,
    planDigest: plan.planDigest,
    mappingDigest: plan.mappingDigest,
    counts
  };
}

function toDatabaseStatus(
  run: LegacyBackfillRunRecord
): "completed" | "failed" | "no_op" {
  switch (run.status) {
  case "applied":
    return "completed";
  case "failed":
  case "mismatch":
    return "failed";
  case "dry_run":
  case "no_op":
    return "no_op";
  }
}

function runMetadata(run: LegacyBackfillRunRecord) {
  return {
    planDigest: run.planDigest,
    mappingDigest: run.mappingDigest,
    schemaVersion: 1,
    outcomeStatus: run.status,
    dryRun: run.dryRun,
    issues: run.issues,
    attempts: [
      {
        runId: run.runId,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt
      }
    ]
  };
}

function revisionTeamResult(
  match: CanonicalLegacyMatch,
  revision: CanonicalLegacyMatchRevision,
  teamId: string,
  sourceResult: "win" | "loss" | "tie" | "pending" | undefined
): "pending" | "win" | "loss" | "tie" | "cancelled" | "forfeited" {
  if (match.status === "cancelled") {
    return "cancelled";
  }
  if (sourceResult !== undefined) {
    return sourceResult;
  }
  if (revision.winnerTeamId !== undefined) {
    return revision.winnerTeamId === teamId ? "win" : "loss";
  }
  return "pending";
}

function bracketSourceType(
  slot: CanonicalLegacyBracketSlot
): "team" | "match_winner" | "bye" | "tbd" {
  const sourceType = slot.sourceType ?? (slot.teamId === undefined ? "tbd" : "team");
  switch (sourceType) {
  case "team":
    return "team";
  case "match-winner":
    return "match_winner";
  case "bye":
    return "bye";
  case "tbd":
    return "tbd";
  case "match-loser":
    throw new Error("Single-elimination legacy backfill cannot use match-loser slots.");
  }
}

function flattenBracketMatches(
  plan: LegacyBackfillPlan
): CanonicalLegacyBracketMatch[] {
  return plan.bracket?.rounds.flatMap((round) => round.matches) ?? [];
}

function requireTeam(plan: LegacyBackfillPlan, teamId: string) {
  const team = plan.teams.find((candidate) => candidate.id === teamId);
  if (team === undefined) {
    throw new Error("Canonical legacy team mapping is missing.");
  }
  return team;
}

function requirePlayer(plan: LegacyBackfillPlan, playerId: string) {
  const player = plan.players.find((candidate) => candidate.id === playerId);
  if (player === undefined) {
    throw new Error("Canonical legacy player mapping is missing.");
  }
  return player;
}

function requireMatch(plan: LegacyBackfillPlan, matchId: string) {
  const match = plan.matches.find((candidate) => candidate.id === matchId);
  if (match === undefined) {
    throw new Error("Canonical legacy match mapping is missing.");
  }
  return match;
}

function requireMapValue<K, V>(values: ReadonlyMap<K, V>, key: K): V {
  const value = values.get(key);
  if (value === undefined) {
    throw new Error("Canonical legacy mapping is missing.");
  }
  return value;
}

function requirePositive(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) {
    throw new Error("Canonical legacy seed is missing or invalid.");
  }
  return value;
}

function metricNumber(
  values: Record<string, number | null>,
  key: string
): number | null {
  const value = values[key];
  return value === undefined || value === null ? null : value;
}

function metricInteger(
  values: Record<string, number | null>,
  key: string
): number | null {
  const value = metricNumber(values, key);
  return value !== null && Number.isInteger(value) ? value : null;
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function writeJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new Error("Legacy backfill value is not JSON serializable.");
  }
  return json;
}

function readCounts(value: unknown): LegacyBackfillCounts {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Legacy backfill counts are invalid.");
  }
  const counts = parsed as Partial<Record<keyof LegacyBackfillCounts, unknown>>;
  const result = {} as LegacyBackfillCounts;
  for (const key of backfillCountKeys) {
    const item = counts[key];
    if (typeof item !== "number" || !Number.isInteger(item) || item < 0) {
      throw new Error(`Legacy backfill count '${key}' is invalid.`);
    }
    result[key] = item;
  }
  return result;
}

const backfillCountKeys: readonly (keyof LegacyBackfillCounts)[] = [
  "tournaments",
  "teams",
  "players",
  "rosterMemberships",
  "pods",
  "matches",
  "identityOnlyMatches",
  "matchRevisions",
  "matchParticipants",
  "standingCalculations",
  "standings",
  "podFinalizations",
  "seedCalculations",
  "seeds",
  "brackets",
  "bracketRounds",
  "bracketMatches",
  "bracketSlots",
  "commentReferences",
  "reportReferences"
];

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original transaction failure.
  }
}
