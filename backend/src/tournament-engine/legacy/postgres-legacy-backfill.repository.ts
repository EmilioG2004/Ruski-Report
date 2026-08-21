import { PoolClient, QueryResult, QueryResultRow } from "pg";

import { PostgresDatabase } from "../../database/postgres-database";
import { createPostgresTransactionContext } from "../../database/postgres-transaction-context";
import { PostgresCanonicalStatisticRepository } from "../persistence/postgres-canonical-statistic.repository";
import { PostgresProjectionRepository } from "../persistence/postgres-projection.repository";
import { parseStableUuid } from "../domain";
import { createUuidV5 } from "../scheduling/uuid-v5";
import type {
  CanonicalPublicMatch,
  CanonicalPublicTournament
} from "../public-projection/contracts";
import { createDigest } from "./legacy-determinism";
import { LegacyBackfillPlanner } from "./legacy-backfill-planner";
import { LegacyBackfillRepository } from "./legacy-backfill.repository";
import { PostgresLegacySnapshotReader } from "./postgres-legacy-snapshot.reader";
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

const LEGACY_BACKFILL_TOOL_VERSION = 2;
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

interface ProjectionTournamentPayloadRow extends QueryResultRow {
  projection_version: number;
  tournament_detail: CanonicalPublicTournament;
}

interface ProjectionMatchPayloadRow extends QueryResultRow {
  match_public_key: string;
  detail_payload: CanonicalPublicMatch;
}

interface LegacyTournamentStatisticCorrectionSummary {
  policy: "canonical_match_events_v1";
  mismatchCount: number;
  mismatchDigest: string;
}

interface LegacyTournamentStatisticCorrection {
  scope: "season" | "playoffs";
  subjectType: "team" | "player";
  subjectId: string;
  metric: string;
  legacyValue: number | null;
  canonicalValue: number | null;
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
  standing_calculation_matches: string;
  standings: string;
  pod_finalizations: string;
  pod_finalization_provenance: string;
  seed_calculations: string;
  seeds: string;
  brackets: string;
  bracket_rounds: string;
  bracket_matches: string;
  bracket_slots: string;
  scoring_events: string;
  shot_attempts: string;
  shot_classifications: string;
  statistic_runs: string;
  statistic_values: string;
  active_statistic_runs: string;
  active_pod_standing_calculations: string;
  active_tournament_standing_calculations: string;
  seed_calculation_finalizations: string;
  active_seed_calculations: string;
  bracket_publications: string;
  active_brackets: string;
  bracket_resolutions: string;
  active_bracket_resolutions: string;
  bracket_advancements: string;
  projection_versions: string;
  tournament_projection_payloads: string;
  match_projection_payloads: string;
  projection_activations: string;
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
    let sessionLocked = false;
    try {
      await lockLegacyTournament(client, plan.legacyTournamentId);
      sessionLocked = true;
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE");
      await revalidateActiveSnapshot(client, plan);

      const existing = await readRecordedState(
        client,
        plan.legacyTournamentId
      );
      if (existing !== null) {
        await client.query("COMMIT");
        return { ...existing, wasApplied: false };
      }

      const protectedDigest = await readProtectedLegacyDigest(client, plan);
      const checkpointId = await beginCheckpoint(client, plan, run);
      await writeCanonicalCore(client, plan, checkpointId);
      const transaction = createPostgresTransactionContext({
        id: run.runId,
        startedAt: run.startedAt,
        metadata: { boundary: "legacy_2026_backfill", schemaVersion: 2 }
      }, client);
      const statisticRevisions = plan.matchRevisions.filter((revision) =>
        !requireMatch(plan, revision.matchId).identityOnly
      );
      if (statisticRevisions.length > 0) {
        await new PostgresCanonicalStatisticRepository(this.database)
          .refreshActiveRevisionsInTransaction({
            tournamentId: plan.tournament.id,
            rulesVersion: 1,
            calculatedAt: plan.sourceSnapshotPublishedAt,
            revisions: statisticRevisions.map((revision) => ({
              matchId: revision.matchId,
              revisionId: revision.id
            }))
          }, transaction);
      }
      await writeCanonicalProgression(client, plan, checkpointId);
      await new PostgresProjectionRepository(this.database)
        .buildAndActivateCanonicalInTransaction({
          tournamentId: parseStableUuid(plan.tournament.id, "tournament"),
          expectedTournamentRowVersion: 2,
          createdAt: plan.sourceSnapshotPublishedAt,
          activatedAt: plan.sourceSnapshotPublishedAt,
          audit: {
            eventId: operationalId(plan, "projection-activation"),
            commandType: "legacy_2026_projection_activation",
            actor: { kind: "legacy_backfill", id: BACKFILL_ACTOR },
            occurredAt: plan.sourceSnapshotPublishedAt,
            details: {
              sourceSnapshotVersion: plan.sourceSnapshotVersion,
              planDigest: plan.planDigest
            }
          }
        }, transaction);
      const statisticCorrections = await assertSemanticProjectionEquivalence(
        client,
        plan
      );
      const protectedDigestAfter = await readProtectedLegacyDigest(client, plan);
      if (protectedDigestAfter !== protectedDigest) {
        throw new Error("Protected legacy identity and moderation rows changed.");
      }
      const actualCounts = await readCanonicalCounts(
        client,
        plan.tournament.id
      );
      assertCountsMatch(plan.counts, actualCounts);
      await completeCheckpoint(
        client,
        checkpointId,
        plan,
        run,
        actualCounts,
        statisticCorrections
      );
      await client.query("COMMIT");

      return { ...stateFromPlan(plan, actualCounts), wasApplied: true };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      let releaseError: Error | undefined;
      if (sessionLocked) {
        try {
          await unlockLegacyTournament(client, plan.legacyTournamentId);
        } catch (error) {
          releaseError = error instanceof Error
            ? error
            : new Error("Legacy backfill session lock could not be released.");
        }
      }
      client.release(releaseError);
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
      SELECT pg_advisory_lock(
        hashtextextended('engine:legacy-backfill:' || $1::text, 0)
      )
    `,
    [legacyTournamentId]
  );
}

async function unlockLegacyTournament(
  executor: SqlExecutor,
  legacyTournamentId: string
): Promise<void> {
  await executor.query(
    `SELECT pg_advisory_unlock(
       hashtextextended('engine:legacy-backfill:' || $1::text, 0)
     )`,
    [legacyTournamentId]
  );
}

async function revalidateActiveSnapshot(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan
): Promise<void> {
  await executor.query(
    `SELECT snapshot_version FROM active_tournament_snapshots
     WHERE tournament_id = $1 FOR UPDATE`,
    [plan.legacyTournamentId]
  );
  const source = await new PostgresLegacySnapshotReader(
    serializedExecutor(executor)
  )
    .readActiveSnapshot(plan.legacyTournamentId);
  if (source === null) {
    throw new Error("The planned active legacy snapshot no longer exists.");
  }
  const lockedPlan = new LegacyBackfillPlanner().plan(source);
  if (
    lockedPlan.sourceSnapshotVersion !== plan.sourceSnapshotVersion ||
    lockedPlan.sourceSnapshotPublishedAt !== plan.sourceSnapshotPublishedAt ||
    lockedPlan.sourceDigest !== plan.sourceDigest ||
    lockedPlan.planDigest !== plan.planDigest
  ) {
    throw new Error("The active legacy snapshot changed after planning.");
  }
}

function serializedExecutor(executor: SqlExecutor): SqlExecutor {
  let pending: Promise<unknown> = Promise.resolve();
  return {
    query<Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[]
    ): Promise<QueryResult<Row>> {
      const result = pending.then(() => executor.query<Row>(text, values));
      pending = result.then(() => undefined, () => undefined);
      return result;
    }
  };
}

async function readProtectedLegacyDigest(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan
): Promise<string> {
  const matchIds = plan.identityReferences.map((reference) =>
    reference.legacyMatchId
  );
  const identities = await executor.query<{
    match_id: string;
    tournament_id: string;
    row_version: string;
  }>(
    `SELECT match_id, tournament_id, xmin::text AS row_version
     FROM match_identities WHERE match_id = ANY($1::text[])
     ORDER BY match_id`,
    [matchIds]
  );
  const comments = await executor.query<{
    id: string;
    match_id: string;
    deleted_at: string | null;
    row_version: string;
  }>(
    `SELECT id, match_id, deleted_at::text, xmin::text AS row_version
     FROM comments WHERE match_id = ANY($1::text[]) ORDER BY id`,
    [matchIds]
  );
  const reports = await executor.query<{
    id: string;
    comment_id: string | null;
    reported_comment_id: string;
    match_id: string;
    status: string;
    reviewed_at: string | null;
    resolved_at: string | null;
    resolution: string | null;
    moderator_id: string | null;
    row_version: string;
  }>(
    `SELECT id, comment_id, reported_comment_id, match_id, status,
            reviewed_at::text, resolved_at::text, resolution, moderator_id,
            xmin::text AS row_version
     FROM comment_reports WHERE match_id = ANY($1::text[]) ORDER BY id`,
    [matchIds]
  );
  const snapshotRows = await executor.query<{
    table_name: string;
    row_key: string;
    row_version: string;
  }>(
    `
      SELECT 'tournaments' AS table_name, id AS row_key,
             xmin::text AS row_version
      FROM tournaments WHERE id = $1
      UNION ALL SELECT 'active_tournament_snapshots', tournament_id,
             xmin::text
      FROM active_tournament_snapshots WHERE tournament_id = $1
      UNION ALL SELECT 'tournament_snapshot_versions',
             tournament_id || ':' || version::text, xmin::text
      FROM tournament_snapshot_versions
      WHERE tournament_id = $1
      UNION ALL SELECT 'teams', snapshot_version::text || ':' || team_id,
             xmin::text FROM teams WHERE tournament_id = $1
      UNION ALL SELECT 'players', snapshot_version::text || ':' || player_id,
             xmin::text FROM players WHERE tournament_id = $1
      UNION ALL SELECT 'team_players', snapshot_version::text || ':' ||
             team_id || ':' || player_id, xmin::text
      FROM team_players WHERE tournament_id = $1
      UNION ALL SELECT 'pods', snapshot_version::text || ':' || pod_id,
             xmin::text FROM pods WHERE tournament_id = $1
      UNION ALL SELECT 'pod_teams', snapshot_version::text || ':' ||
             pod_id || ':' || team_id, xmin::text
      FROM pod_teams WHERE tournament_id = $1
      UNION ALL SELECT 'pod_matches', snapshot_version::text || ':' ||
             pod_id || ':' || match_id, xmin::text
      FROM pod_matches WHERE tournament_id = $1
      UNION ALL SELECT 'matches', snapshot_version::text || ':' || match_id,
             xmin::text FROM matches WHERE tournament_id = $1
      UNION ALL SELECT 'standings', snapshot_version::text || ':' || standing_id,
             xmin::text FROM standings WHERE tournament_id = $1
      UNION ALL SELECT 'scorebook_sources', source.id, source.xmin::text
      FROM scorebook_sources source
      WHERE source.id IN (
        SELECT snapshot.source_id FROM tournament_snapshot_versions snapshot
        WHERE snapshot.tournament_id = $1
      )
      UNION ALL SELECT 'upload_reports', report.id, report.xmin::text
      FROM upload_reports report
      WHERE report.tournament_id = $1 OR report.source_id IN (
        SELECT snapshot.source_id FROM tournament_snapshot_versions snapshot
        WHERE snapshot.tournament_id = $1
      )
      ORDER BY table_name, row_key
    `,
    [plan.legacyTournamentId]
  );
  const accountRows = await executor.query<{
    table_name: string;
    row_key: string;
    row_version: string;
  }>(
    `
      WITH relevant_accounts AS (
        SELECT author_user_id AS user_id
        FROM comments WHERE match_id = ANY($1::text[])
        UNION
        SELECT reporter_user_id FROM comment_reports
        WHERE match_id = ANY($1::text[])
      )
      SELECT 'user_accounts' AS table_name, account.id AS row_key,
             account.xmin::text AS row_version
      FROM user_accounts account
      WHERE account.id IN (SELECT user_id FROM relevant_accounts)
      UNION ALL SELECT 'local_account_credentials', credential.user_id,
             credential.xmin::text
      FROM local_account_credentials credential
      WHERE credential.user_id IN (SELECT user_id FROM relevant_accounts)
      UNION ALL SELECT 'external_identities',
             identity.provider || ':' || identity.provider_subject,
             identity.xmin::text
      FROM external_identities identity
      WHERE identity.user_id IN (SELECT user_id FROM relevant_accounts)
      UNION ALL SELECT 'auth_sessions', session.id, session.xmin::text
      FROM auth_sessions session
      WHERE session.user_id IN (SELECT user_id FROM relevant_accounts)
      UNION ALL SELECT 'user_blocks',
             block.blocker_user_id || ':' || block.blocked_user_id,
             block.xmin::text
      FROM user_blocks block
      WHERE block.blocker_user_id IN (SELECT user_id FROM relevant_accounts)
         OR block.blocked_user_id IN (SELECT user_id FROM relevant_accounts)
      ORDER BY table_name, row_key
    `,
    [matchIds]
  );
  return createDigest({
    snapshotRows: snapshotRows.rows,
    identities: identities.rows,
    comments: comments.rows,
    reports: reports.rows,
    accountsAndBlocks: accountRows.rows
  });
}

async function assertSemanticProjectionEquivalence(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan
): Promise<LegacyTournamentStatisticCorrectionSummary> {
  const tournamentResult = await executor.query<ProjectionTournamentPayloadRow>(
    `
      SELECT payload.projection_version, payload.tournament_detail
      FROM engine_active_projection_versions active
      JOIN engine_public_tournament_projection_payloads payload
        ON payload.tournament_id = active.tournament_id
       AND payload.projection_version = active.projection_version
      WHERE active.tournament_id = $1::uuid
    `,
    [plan.tournament.id]
  );
  const tournament = tournamentResult.rows[0]?.tournament_detail;
  if (tournament === undefined) {
    throw new Error("Canonical legacy tournament projection is missing.");
  }
  assertDigestEqual("tournament", {
    id: plan.tournament.publicKey,
    gameType: plan.tournament.gameType,
    year: plan.tournament.year,
    name: plan.tournament.name,
    lifecycle: plan.tournament.lifecycle,
    format: plan.tournament.configuration
  }, {
    id: tournament.id,
    gameType: tournament.gameType,
    year: tournament.year,
    name: tournament.name,
    lifecycle: tournament.lifecycle,
    format: tournament.format
  });
  const statisticCorrections = summarizeLegacyTournamentStatisticCorrections(
    plan,
    tournament
  );

  const podByTeam = new Map(
    plan.pods.flatMap((pod) => pod.teamIds.map((teamId) => [teamId, pod]))
  );
  assertDigestEqual("rosters", plan.teams.map((team) => ({
    id: team.publicKey,
    name: team.name,
    podId: requireMapValue(podByTeam, team.id).publicKey,
    initialPodSeed: team.initialPodSeed,
    players: plan.rosterMemberships
      .filter((membership) =>
        membership.teamId === team.id && membership.effectiveTo === undefined
      )
      .sort((left, right) => left.sequence - right.sequence)
      .map((membership) => ({
        id: requirePlayer(plan, membership.playerId).publicKey,
        displayName: requirePlayer(plan, membership.playerId).displayName,
        rosterSlot: membership.sequence
      }))
  })), tournament.rosters);

  assertDigestEqual("pods", plan.pods.map((pod) => ({
    id: pod.publicKey,
    name: pod.name,
    sequence: pod.sequence,
    standingState: "finalized",
    standings: plan.standings
      .filter((standing) => standing.podId === pod.id)
      .sort((left, right) => left.rank - right.rank)
      .map((standing) => ({
        team: {
          id: requireTeam(plan, standing.teamId).publicKey,
          name: requireTeam(plan, standing.teamId).name
        },
        rank: standing.rank,
        wins: standing.wins,
        losses: standing.losses,
        cupDifferential: metricInteger(
          standing.metricValues,
          "cupDifferential"
        ) ?? 0,
        makes: metricInteger(standing.metricValues, "makes") ?? 0,
        attempts: metricInteger(standing.metricValues, "attempts") ?? 0,
        shootingPercentage: metricNumber(
          standing.metricValues,
          "shootingPercentage"
        )
      }))
  })), tournament.pods.map((pod) => ({
    id: pod.id,
    name: pod.name,
    sequence: pod.sequence,
    standingState: pod.standingState,
    standings: pod.standings.map((standing) => ({
      team: standing.team,
      rank: standing.rank,
      wins: standing.wins,
      losses: standing.losses,
      cupDifferential: standing.cupDifferential,
      makes: standing.makes,
      attempts: standing.attempts,
      shootingPercentage: standing.shootingPercentage
    }))
  })));

  assertDigestEqual("seeds", plan.seeds.filter((seed) => seed.qualified)
    .sort((left, right) =>
      (left.effectivePlayoffSeed ?? 0) - (right.effectivePlayoffSeed ?? 0)
    )
    .map((seed) => ({
      team: {
        id: requireTeam(plan, seed.teamId).publicKey,
        name: requireTeam(plan, seed.teamId).name
      },
      calculatedSeed: seed.calculatedPlayoffSeed ?? null,
      effectiveSeed: seed.effectivePlayoffSeed ?? null,
      overridden: false
    })), tournament.seeds);

  const expectedBracket = plan.bracket === undefined ? null : {
    id: plan.bracket.publicKey,
    name: plan.bracket.name,
    size: plan.tournament.configuration.bracketSize,
    rounds: plan.bracket.rounds.map((round) => ({
      id: round.publicKey,
      name: round.name,
      sequence: round.sequence,
      matches: round.matches.map((match) => ({
        id: match.publicKey,
        round: round.sequence,
        position: match.sequence,
        status: match.status,
        matchId: requireMatch(plan, match.matchId).publicKey,
        slots: match.slots.map((slot) => normalizedExpectedBracketSlot(plan, slot)),
        winner: match.winnerTeamId === undefined ? null : {
          id: requireTeam(plan, match.winnerTeamId).publicKey,
          name: requireTeam(plan, match.winnerTeamId).name
        }
      }))
    }))
  };
  const actualBracket = tournament.bracket === null ? null : {
    id: tournament.bracket.id,
    name: tournament.bracket.name,
    size: tournament.bracket.size,
    rounds: tournament.bracket.rounds.map((round) => ({
      id: round.id,
      name: round.name,
      sequence: round.sequence,
      matches: round.matches.map((match) => ({
        id: match.id,
        round: match.round,
        position: match.position,
        status: match.status,
        matchId: match.matchId,
        slots: match.slots,
        winner: match.winner
      }))
    }))
  };
  assertDigestEqual("bracket", expectedBracket, actualBracket);

  const matchResult = await executor.query<ProjectionMatchPayloadRow>(
    `
      SELECT payload.match_public_key, payload.detail_payload
      FROM engine_active_projection_versions active
      JOIN engine_public_match_projection_payloads payload
        ON payload.tournament_id = active.tournament_id
       AND payload.projection_version = active.projection_version
      WHERE active.tournament_id = $1::uuid
      ORDER BY payload.match_public_key
    `,
    [plan.tournament.id]
  );
  const payloadByMatch = new Map(matchResult.rows.map((row) => [
    row.match_public_key,
    row.detail_payload
  ]));
  for (const match of plan.matches.filter((candidate) => !candidate.identityOnly)) {
    const payload = payloadByMatch.get(match.publicKey);
    const revision = plan.matchRevisions.find((candidate) =>
      candidate.matchId === match.id
    );
    if (payload === undefined || revision === undefined) {
      throw new Error("Canonical legacy match projection is incomplete.");
    }
    assertDigestEqual(`match-core:${match.publicKey}`, {
      id: match.publicKey,
      sequence: match.sequence,
      stage: match.stage,
      podId: match.podId === undefined ? null :
        requireMapValue(new Map(plan.pods.map((pod) => [pod.id, pod.publicKey])),
          match.podId),
      bracketMatchId: match.bracketMatchId === undefined ? null :
        requireBracketMatch(plan, match.bracketMatchId).publicKey,
      status: match.status,
      scoreAvailability: match.scoreAvailability,
      winnerId: revision.winnerTeamId === undefined
        ? null
        : requireTeam(plan, revision.winnerTeamId).publicKey
    }, {
      id: payload.id,
      sequence: payload.sequence,
      stage: payload.stage,
      podId: payload.podId,
      bracketMatchId: payload.bracketMatchId,
      status: payload.status,
      scoreAvailability: payload.scoreAvailability,
      winnerId: payload.winner?.id ?? null
    });
    assertDigestEqual(`match-participants:${match.publicKey}`,
      revision.participants.map((participant, index) => ({
        side: index + 1,
        team: {
          id: requireTeam(plan, participant.teamId).publicKey,
          name: requireTeam(plan, participant.teamId).name
        },
        players: participant.playerIds.map((playerId, playerIndex) => ({
          id: requirePlayer(plan, playerId).publicKey,
          displayName: requirePlayer(plan, playerId).displayName,
          rosterSlot: playerIndex + 1
        })),
        seed: expectedMatchParticipantSeed(
          plan,
          match,
          participant.teamId,
          participant.seed
        ),
        score: participant.score ??
          revision.scores.find((score) => score.teamId === participant.teamId)
            ?.score ?? null,
        result: revisionTeamResult(
          match,
          revision,
          participant.teamId,
          participant.result
        ) === "pending" ? null : revisionTeamResult(
          match,
          revision,
          participant.teamId,
          participant.result
        )
      })), payload.participants.map((participant) => ({
        side: participant.side,
        team: participant.team,
        players: participant.players,
        seed: participant.seed,
        score: participant.score,
        result: participant.result
      }))
    );
    assertDigestEqual(`match-events:${match.publicKey}`,
      revision.events.map((event) => ({
        sequence: event.sequence,
        type: event.type,
        teamId: requireTeam(plan, event.teamId).publicKey,
        playerId: requirePlayer(plan, event.playerId).publicKey,
        outcome: event.shotAttempt?.outcome ?? null,
        classification: event.shotAttempt?.classification ?? null,
        cupDelta: event.shotAttempt?.cupDelta ?? null
      })), payload.events.map((event) => ({
        sequence: event.sequence,
        type: event.type,
        teamId: event.teamId,
        playerId: event.playerId,
        outcome: event.details.outcome ?? null,
        classification: event.details.classification ?? null,
        cupDelta: event.details.cupDelta ?? null
      }))
    );
    assertLegacyStatisticsEquivalent(plan, revision, payload);
    const expectedShotRows = revision.events.filter(
      (event) => event.type === "shot_attempt"
    ).length;
    if (match.scoreAvailability === "complete" ||
        match.scoreAvailability === "partial") {
      if (payload.scorecard?.rows.length !== expectedShotRows) {
        throw new Error("Canonical legacy scorecard chronology differs from v1.");
      }
    } else if (payload.boxScore !== null || payload.scorecard !== null) {
      throw new Error("Unrecorded legacy details became ordinary scored details.");
    }
  }
  if (payloadByMatch.size !== plan.counts.matchProjectionPayloads) {
    throw new Error("Canonical projection contains an unexpected match set.");
  }
  return statisticCorrections;
}

function expectedMatchParticipantSeed(
  plan: LegacyBackfillPlan,
  match: CanonicalLegacyMatch,
  teamId: string,
  sourceSeed: number | undefined
): number | null {
  if (match.bracketMatchId === undefined) {
    return sourceSeed ?? null;
  }
  const bracketSeed = requireBracketMatch(plan, match.bracketMatchId).slots
    .find((slot) => slot.teamId === teamId)?.seed;
  return bracketSeed ?? sourceSeed ?? null;
}

function normalizedExpectedBracketSlot(
  plan: LegacyBackfillPlan,
  slot: CanonicalLegacyBracketSlot
): unknown {
  const seed = slot.seed ?? null;
  const team = slot.teamId === undefined ? null : {
    id: requireTeam(plan, slot.teamId).publicKey,
    name: requireTeam(plan, slot.teamId).name
  };
  switch (bracketSourceType(slot)) {
  case "team":
    return { source: "team", team, seed };
  case "match_winner":
    return {
      source: "match_winner",
      sourceBracketMatchId: requireBracketMatch(
        plan,
        slot.sourceBracketMatchId as string
      ).publicKey,
      team,
      seed
    };
  case "bye":
    return { source: "bye", team: null, seed: null };
  case "tbd":
    return { source: "tbd", team: null, seed: null };
  }
}

function assertLegacyStatisticsEquivalent(
  plan: LegacyBackfillPlan,
  revision: CanonicalLegacyMatchRevision,
  payload: CanonicalPublicMatch
): void {
  const explicitPlayerIds = new Set(revision.sourceStatistics.flatMap(
    (statistic) => statistic.playerId === undefined
      ? []
      : [requirePlayer(plan, statistic.playerId).publicKey]
  ));
  for (const statistic of revision.sourceStatistics) {
    const teamPublicKey = statistic.teamId === undefined
      ? undefined
      : requireTeam(plan, statistic.teamId).publicKey;
    const playerPublicKey = statistic.playerId === undefined
      ? undefined
      : requirePlayer(plan, statistic.playerId).publicKey;
    const candidates = (payload.boxScore?.rows ?? []).filter((row) => {
      if (playerPublicKey !== undefined) {
        return row.subject.type === "player" &&
          row.subject.id === playerPublicKey;
      }
      return row.teamId === teamPublicKey && (
        row.subject.type === "team" ||
        !explicitPlayerIds.has(row.subject.id)
      );
    }).filter((row) => Object.entries(statistic.metricValues).every(
      ([legacyMetric, expected]) => {
        const canonicalMetric = legacyMetricMap[legacyMetric];
        return canonicalMetric === undefined || numbersEquivalent(
          expected,
          row.values[canonicalMetric]
        );
      }
    ));
    if (candidates.length !== 1) {
      throw new Error(
        candidates.length === 0
          ? "Canonical legacy statistic differs from v1."
          : "Canonical legacy statistic subject is ambiguous."
      );
    }
  }
}

function summarizeLegacyTournamentStatisticCorrections(
  plan: LegacyBackfillPlan,
  tournament: CanonicalPublicTournament
): LegacyTournamentStatisticCorrectionSummary {
  const corrections: LegacyTournamentStatisticCorrection[] = [];
  for (const table of plan.tournament.sourceStatistics) {
    const stage = table.scope === "season" ? null : "playoffs";
    for (const sourceRow of table.rows) {
      const subjectId = table.subjectType === "team"
        ? requireLegacyTeam(plan, sourceRow.legacyTeamId as string).publicKey
        : requireLegacyPlayer(
          plan,
          sourceRow.legacyPlayerId as string
        ).publicKey;
      const canonical = tournament.statistics.find((candidate) =>
        candidate.scope === "tournament" &&
        candidate.scopeId === plan.tournament.publicKey &&
        candidate.stage === stage && candidate.subject?.id === subjectId
      );
      if (canonical === undefined) {
        throw new Error("Canonical legacy tournament statistic subject is missing.");
      }
      for (const [legacyMetric, expected] of Object.entries(
        sourceRow.metricValues
      )) {
        const canonicalMetric = legacyMetricMap[legacyMetric];
        if (canonicalMetric === undefined) {
          continue;
        }
        const actual = canonical.values[canonicalMetric];
        if (actual === undefined) {
          throw new Error("Canonical legacy tournament statistic is incomplete.");
        }
        if (!numbersEquivalent(expected, actual)) {
          corrections.push({
            scope: table.scope,
            subjectType: table.subjectType,
            subjectId,
            metric: canonicalMetric,
            legacyValue: expected,
            canonicalValue: actual
          });
        }
      }
    }
  }
  corrections.sort((left, right) =>
    left.scope.localeCompare(right.scope) ||
    left.subjectType.localeCompare(right.subjectType) ||
    left.subjectId.localeCompare(right.subjectId) ||
    left.metric.localeCompare(right.metric)
  );
  return {
    policy: "canonical_match_events_v1",
    mismatchCount: corrections.length,
    mismatchDigest: createDigest(corrections)
  };
}

const legacyMetricMap: Readonly<Record<string, string>> = {
  makes: "makes",
  misses: "misses",
  attempts: "attempts",
  shootingPercentage: "shooting_percentage",
  splashOuts: "splash_outs",
  guys: "guys",
  tris: "tris",
  dis: "dis",
  voms: "voms",
  cupsScored: "cups_scored",
  cupsAgainst: "cups_against",
  cupDifferential: "cup_differential"
};

function numbersEquivalent(
  expected: number | null,
  actual: number | null | undefined
): boolean {
  if (expected === null || actual === null || actual === undefined) {
    return expected === actual;
  }
  return Math.abs(expected - actual) <= 1e-10;
}

function assertDigestEqual(label: string, expected: unknown, actual: unknown): void {
  if (createDigest(expected) !== createDigest(actual)) {
    throw new Error(`Canonical legacy ${label} projection differs from v1.`);
  }
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
  counts: LegacyBackfillCounts,
  statisticCorrections: LegacyTournamentStatisticCorrectionSummary
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
        schemaVersion: plan.schemaVersion,
        tournamentStatisticCorrections: statisticCorrections
      })
    ]
  );
}

async function writeCanonicalCore(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan,
  checkpointId: string
): Promise<void> {
  await writeTournament(executor, plan);
  await writeTeamsPlayersPods(executor, plan);
  await transitionLegacyTournament(executor, plan);
  await writeMatchesAndRevisions(executor, plan, checkpointId);
}

async function writeCanonicalProgression(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan,
  checkpointId: string
): Promise<void> {
  await writeStandingsAndSeeds(executor, plan, checkpointId);
  await writeBracket(executor, plan, checkpointId);
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
        writeJson({
          legacyPlayerId: player.legacyPlayerId,
          legacyIdentitySource: player.sourceSnapshotVersion === undefined
            ? "frozen_match_participant"
            : "player_snapshot"
        })
      ]
    );
  }
  for (const membership of plan.rosterMemberships) {
    await executor.query(
      `
        INSERT INTO engine_roster_memberships (
          id, tournament_id, public_key, team_id, player_id, roster_slot,
          opened_at, closed_at, opened_by, closed_by, replacement_reason,
          metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6, $7, $8, $9,
          $10, $11, $12::jsonb
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
        membership.effectiveTo ?? null,
        BACKFILL_ACTOR,
        membership.effectiveTo === undefined ? null : BACKFILL_ACTOR,
        membership.replacementReason ?? null,
        writeJson({
          legacyTeamId: membership.legacyTeamId,
          legacyPlayerId: membership.legacyPlayerId,
          legacyIdentitySource:
            membership.sourceSnapshotVersion === undefined
              ? "frozen_match_participant"
              : "roster_snapshot"
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
  plan: LegacyBackfillPlan,
  checkpointId: string
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
    await writeRevision(
      executor,
      plan,
      match,
      revision,
      membershipsByTeamPlayer,
      checkpointId
    );
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
  >,
  checkpointId: string
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
        legacyBackfillRunId: checkpointId,
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
  for (const event of revision.events) {
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
        tournamentId,
        revision.id,
        event.sequence,
        event.type,
        event.teamId,
        event.playerId,
        event.occurredAt ?? null,
        event.sourceReference,
        revision.sourceUpdatedAt,
        writeJson({
          legacyEventId: event.legacyEventId,
          sourceSnapshotVersion: revision.sourceSnapshotVersion,
          legacyScorecardRowId: event.legacyScorecardRowId,
          attributionMethod: event.attributionMethod
        })
      ]
    );
    if (event.shotAttempt !== undefined) {
      await executor.query(
        `
          INSERT INTO engine_shot_attempts (
            event_id, outcome, cup_delta, phase, turn_number,
            team_turn_order, shot_in_team_turn
          ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
        `,
        [
          event.id,
          event.shotAttempt.outcome,
          event.shotAttempt.cupDelta,
          event.shotAttempt.phase ?? null,
          event.shotAttempt.turnNumber ?? null,
          event.shotAttempt.teamTurnOrder ?? null,
          event.shotAttempt.shotInTeamTurn ?? null
        ]
      );
      if (event.shotAttempt.classification !== undefined) {
        await executor.query(
          `INSERT INTO engine_shot_classifications (event_id, classification)
           VALUES ($1::uuid, $2)`,
          [event.id, event.shotAttempt.classification]
        );
      }
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
      const revision = revisionsByMatch.get(match.id);
      const slots = revision === undefined
        ? bracketMatch.slots
        : revision.participants.map((participant, index) => {
            const slot = bracketMatch.slots.find((candidate) =>
              candidate.teamId === participant.teamId
            );
            if (slot === undefined) {
              throw new Error(
                "Legacy playoff participant is absent from its bracket slots."
              );
            }
            return { ...slot, sequence: index + 1 };
          });
      for (const slot of slots) {
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
            seed, metadata
          ) VALUES (
            $1::uuid, $2::uuid, $3, 'team', $4::uuid, $5, $6::jsonb
          )
        `,
        [
          tournamentId,
          match.id,
          index + 1,
          participant.teamId,
          participant.seed ?? null,
          writeJson({ legacyBackfill: true })
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
  plan: LegacyBackfillPlan,
  checkpointId: string
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
    const revisions = new Map(
      plan.matchRevisions.map((revision) => [revision.matchId, revision])
    );
    for (const match of plan.matches.filter((candidate) =>
      !candidate.identityOnly && candidate.podId === calculation.podId
    )) {
      const revision = requireMapValue(revisions, match.id);
      const authority = standingMatchAuthority(match);
      const inserted = await executor.query(
        `
          INSERT INTO engine_standing_calculation_matches (
            tournament_id, calculation_id, match_id, revision_id,
            statistic_run_id, statistic_input_digest, status,
            score_availability, disposition, blocking_reason, metadata
          )
          SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid,
                 scope.statistic_run_id, run.input_digest, $5, $6, $7, $8,
                 $9::jsonb
          FROM engine_canonical_statistic_run_scopes scope
          JOIN engine_statistic_runs run ON run.id = scope.statistic_run_id
          WHERE scope.tournament_id = $1::uuid
            AND scope.match_id = $3::uuid
            AND scope.revision_id = $4::uuid
            AND scope.run_kind = 'match_revision'
        `,
        [
          tournamentId,
          calculation.id,
          match.id,
          revision.id,
          match.status,
          match.scoreAvailability,
          authority.disposition,
          authority.blockingReason ?? null,
          writeJson({ source: "legacy_backfill" })
        ]
      );
      if (inserted.rowCount !== 1) {
        throw new Error("Legacy standing match statistic authority is missing.");
      }
    }
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
        INSERT INTO engine_pod_finalization_provenance (
          finalization_id, tournament_id, pod_id, calculation_id,
          override_digest, confirmation_digest, finalized_by_admin_id,
          metadata, provenance_kind, legacy_backfill_run_id
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid,
          $5, $6, NULL, $7::jsonb, 'legacy_backfill', $8::uuid
        )
      `,
      [
        finalization.id,
        tournamentId,
        finalization.podId,
        finalization.calculationId,
        createDigest([]),
        createDigest({
          kind: "legacy_pod_finalization",
          finalizationId: finalization.id,
          calculationId: finalization.calculationId,
          planDigest: plan.planDigest
        }),
        writeJson({ source: "legacy_backfill" }),
        checkpointId
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
  for (const calculation of plan.standingCalculations) {
    if (calculation.scope === "pod") {
      await executor.query(
        `
          INSERT INTO engine_active_pod_standing_calculations (
            tournament_id, pod_id, calculation_id, activated_at
          ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
        `,
        [
          tournamentId,
          calculation.podId,
          calculation.id,
          plan.sourceSnapshotPublishedAt
        ]
      );
    } else {
      await executor.query(
        `
          INSERT INTO engine_active_tournament_standing_calculations (
            tournament_id, calculation_id, activated_at
          ) VALUES ($1::uuid, $2::uuid, $3)
        `,
        [tournamentId, calculation.id, plan.sourceSnapshotPublishedAt]
      );
    }
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
    for (const finalization of plan.podFinalizations) {
      await executor.query(
        `
          INSERT INTO engine_seed_calculation_finalizations (
            tournament_id, calculation_id, pod_id, finalization_id
          ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
        `,
        [
          tournamentId,
          plan.seedCalculation.id,
          finalization.podId,
          finalization.id
        ]
      );
    }
    await executor.query(
      `
        INSERT INTO engine_active_seed_calculations (
          tournament_id, calculation_id, activated_at
        ) VALUES ($1::uuid, $2::uuid, $3)
      `,
      [tournamentId, plan.seedCalculation.id, plan.sourceSnapshotPublishedAt]
    );
  }
}

function standingMatchAuthority(match: CanonicalLegacyMatch): {
  disposition: "included_final" | "included_forfeit" |
    "excluded_cancelled" | "blocking";
  blockingReason?: "scheduled" | "postponed" | "in_progress" |
    "final_unrecorded";
} {
  if (match.status === "forfeited") {
    return { disposition: "included_forfeit" };
  }
  if (match.status === "cancelled") {
    return { disposition: "excluded_cancelled" };
  }
  if (match.status === "final" && match.scoreAvailability !== "unrecorded") {
    return { disposition: "included_final" };
  }
  return {
    disposition: "blocking",
    blockingReason: match.status === "final"
      ? "final_unrecorded"
      : match.status === "in_progress"
        ? "in_progress"
        : match.status === "postponed" ? "postponed" : "scheduled"
  };
}

async function writeBracket(
  executor: SqlExecutor,
  plan: LegacyBackfillPlan,
  checkpointId: string
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
  const seedCalculationId = plan.seedCalculation?.id;
  if (seedCalculationId === undefined) {
    throw new Error("A legacy playoff bracket requires its active seed calculation.");
  }
  const publicationId = operationalId(plan, "bracket-publication");
  await executor.query(
    `
      INSERT INTO engine_bracket_publications (
        id, tournament_id, bracket_id, seed_calculation_id,
        seed_override_command_id, cumulative_workbook_id,
        confirmation_digest, published_by_admin_id, published_at, metadata,
        provenance_kind, legacy_backfill_run_id
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        NULL, NULL, $5, NULL, $6, $7::jsonb,
        'legacy_backfill', $8::uuid
      )
    `,
    [
      publicationId,
      tournamentId,
      bracket.id,
      seedCalculationId,
      createDigest({
        kind: "legacy_bracket_publication",
        bracketId: bracket.id,
        seedCalculationId,
        planDigest: plan.planDigest
      }),
      plan.sourceSnapshotPublishedAt,
      writeJson({
        source: "legacy_backfill",
        sourceSnapshotVersion: plan.sourceSnapshotVersion
      }),
      checkpointId
    ]
  );
  await executor.query(
    `
      INSERT INTO engine_active_brackets (
        tournament_id, bracket_id, publication_id, activated_at
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
    `,
    [tournamentId, bracket.id, publicationId, plan.sourceSnapshotPublishedAt]
  );

  const revisionsByMatch = new Map(
    plan.matchRevisions.map((revision) => [revision.matchId, revision])
  );
  for (const bracketMatch of bracketMatches.filter(
    (match) => match.status === "completed" && match.winnerTeamId !== undefined
  )) {
    const revision = requireMapValue(revisionsByMatch, bracketMatch.matchId);
    const engineMatch = requireMatch(plan, bracketMatch.matchId);
    const resolutionId = operationalId(
      plan,
      `bracket-resolution:${bracketMatch.id}:${revision.id}`
    );
    await executor.query(
      `
        INSERT INTO engine_bracket_match_resolutions (
          id, tournament_id, bracket_match_id, match_id, revision_id,
          winner_team_id, resolution_type, match_status,
          confirmation_digest, resolved_by_admin_id, resolved_at, metadata,
          provenance_kind, legacy_backfill_run_id
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
          $6::uuid, 'match_result', $7,
          $8, NULL, $9, $10::jsonb,
          'legacy_backfill', $11::uuid
        )
      `,
      [
        resolutionId,
        tournamentId,
        bracketMatch.id,
        bracketMatch.matchId,
        revision.id,
        bracketMatch.winnerTeamId,
        engineMatch.status === "forfeited" ? "forfeited" : "final",
        createDigest({
          kind: "legacy_bracket_resolution",
          bracketMatchId: bracketMatch.id,
          revisionId: revision.id,
          winnerTeamId: bracketMatch.winnerTeamId
        }),
        plan.sourceSnapshotPublishedAt,
        writeJson({ source: "legacy_backfill" }),
        checkpointId
      ]
    );
    await executor.query(
      `
        INSERT INTO engine_active_bracket_match_resolutions (
          tournament_id, bracket_match_id, resolution_id, activated_at
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
      `,
      [
        tournamentId,
        bracketMatch.id,
        resolutionId,
        plan.sourceSnapshotPublishedAt
      ]
    );
  }
  const bracketById = new Map(
    bracketMatches.map((match) => [match.id, match])
  );
  for (const destination of bracketMatches) {
    for (const slot of destination.slots.filter((candidate) =>
      candidate.sourceType === "match-winner"
    )) {
      const source = requireMapValue(
        bracketById,
        slot.sourceBracketMatchId as string
      );
      const sourceRevision = requireMapValue(revisionsByMatch, source.matchId);
      const winnerTeamId = source.winnerTeamId;
      if (winnerTeamId === undefined || slot.teamId !== winnerTeamId) {
        throw new Error("Legacy bracket advancement winner evidence is invalid.");
      }
      const sourceResolutionId = operationalId(
        plan,
        `bracket-resolution:${source.id}:${sourceRevision.id}`
      );
      await executor.query(
        `
          INSERT INTO engine_bracket_advancements (
            id, tournament_id, source_bracket_match_id,
            source_resolution_id, destination_bracket_match_id,
            destination_slot_number, winner_team_id, previous_team_id,
            confirmation_digest, advanced_by_admin_id, advanced_at, metadata,
            provenance_kind, legacy_backfill_run_id
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid,
            $4::uuid, $5::uuid, $6, $7::uuid, NULL,
            $8, NULL, $9, $10::jsonb,
            'legacy_backfill', $11::uuid
          )
        `,
        [
          operationalId(
            plan,
            `bracket-advancement:${source.id}:${destination.id}:${slot.sequence}`
          ),
          tournamentId,
          source.id,
          sourceResolutionId,
          destination.id,
          slot.sequence,
          winnerTeamId,
          createDigest({
            kind: "legacy_bracket_advancement",
            sourceBracketMatchId: source.id,
            sourceResolutionId,
            destinationBracketMatchId: destination.id,
            destinationSlotNumber: slot.sequence,
            winnerTeamId
          }),
          plan.sourceSnapshotPublishedAt,
          writeJson({ source: "legacy_backfill" }),
          checkpointId
        ]
      );
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
    if (player.sourceSnapshotVersion === undefined) {
      continue;
    }
    await executor.query(
      `
        INSERT INTO engine_legacy_player_links (
          engine_player_id, engine_tournament_id, legacy_tournament_id,
          source_snapshot_version, legacy_player_id, backfill_run_id
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
      `,
      [
        player.id,
        tournamentId,
        plan.legacyTournamentId,
        player.sourceSnapshotVersion,
        player.legacyPlayerId,
        checkpointId
      ]
    );
  }
  for (const membership of plan.rosterMemberships) {
    if (membership.sourceSnapshotVersion === undefined) {
      continue;
    }
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
        tournamentId,
        plan.legacyTournamentId,
        membership.sourceSnapshotVersion,
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
        (SELECT count(*) FROM engine_standing_calculation_matches
          WHERE tournament_id = $1::uuid) AS standing_calculation_matches,
        (SELECT count(*) FROM engine_standing_rows
          WHERE tournament_id = $1::uuid) AS standings,
        (SELECT count(*) FROM engine_pod_finalizations
          WHERE tournament_id = $1::uuid) AS pod_finalizations,
        (SELECT count(*) FROM engine_pod_finalization_provenance
          WHERE tournament_id = $1::uuid) AS pod_finalization_provenance,
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
        (SELECT count(*) FROM engine_match_events
          WHERE tournament_id = $1::uuid) AS scoring_events,
        (SELECT count(*) FROM engine_shot_attempts attempt
          JOIN engine_match_events event ON event.id = attempt.event_id
          WHERE event.tournament_id = $1::uuid) AS shot_attempts,
        (SELECT count(*) FROM engine_shot_classifications classification
          JOIN engine_match_events event ON event.id = classification.event_id
          WHERE event.tournament_id = $1::uuid) AS shot_classifications,
        (SELECT count(*) FROM engine_canonical_statistic_run_scopes
          WHERE tournament_id = $1::uuid) AS statistic_runs,
        (SELECT count(*) FROM engine_canonical_statistic_values
          WHERE tournament_id = $1::uuid) AS statistic_values,
        (SELECT count(*) FROM engine_active_tournament_statistic_runs
          WHERE tournament_id = $1::uuid) AS active_statistic_runs,
        (SELECT count(*) FROM engine_active_pod_standing_calculations
          WHERE tournament_id = $1::uuid)
          AS active_pod_standing_calculations,
        (SELECT count(*) FROM engine_active_tournament_standing_calculations
          WHERE tournament_id = $1::uuid)
          AS active_tournament_standing_calculations,
        (SELECT count(*) FROM engine_seed_calculation_finalizations
          WHERE tournament_id = $1::uuid) AS seed_calculation_finalizations,
        (SELECT count(*) FROM engine_active_seed_calculations
          WHERE tournament_id = $1::uuid) AS active_seed_calculations,
        (SELECT count(*) FROM engine_bracket_publications
          WHERE tournament_id = $1::uuid) AS bracket_publications,
        (SELECT count(*) FROM engine_active_brackets
          WHERE tournament_id = $1::uuid) AS active_brackets,
        (SELECT count(*) FROM engine_bracket_match_resolutions
          WHERE tournament_id = $1::uuid) AS bracket_resolutions,
        (SELECT count(*) FROM engine_active_bracket_match_resolutions
          WHERE tournament_id = $1::uuid) AS active_bracket_resolutions,
        (SELECT count(*) FROM engine_bracket_advancements
          WHERE tournament_id = $1::uuid) AS bracket_advancements,
        (SELECT count(*) FROM engine_projection_versions
          WHERE tournament_id = $1::uuid) AS projection_versions,
        (SELECT count(*) FROM engine_public_tournament_projection_payloads
          WHERE tournament_id = $1::uuid) AS tournament_projection_payloads,
        (SELECT count(*) FROM engine_public_match_projection_payloads
          WHERE tournament_id = $1::uuid) AS match_projection_payloads,
        (SELECT count(*) FROM engine_public_projection_activations
          WHERE tournament_id = $1::uuid) AS projection_activations
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
    standingCalculationMatches: Number(row.standing_calculation_matches),
    standings: Number(row.standings),
    podFinalizations: Number(row.pod_finalizations),
    podFinalizationProvenance: Number(row.pod_finalization_provenance),
    seedCalculations: Number(row.seed_calculations),
    seeds: Number(row.seeds),
    brackets: Number(row.brackets),
    bracketRounds: Number(row.bracket_rounds),
    bracketMatches: Number(row.bracket_matches),
    bracketSlots: Number(row.bracket_slots),
    scoringEvents: Number(row.scoring_events),
    shotAttempts: Number(row.shot_attempts),
    shotClassifications: Number(row.shot_classifications),
    statisticRuns: Number(row.statistic_runs),
    statisticValues: Number(row.statistic_values),
    activeStatisticRuns: Number(row.active_statistic_runs),
    activePodStandingCalculations: Number(
      row.active_pod_standing_calculations
    ),
    activeTournamentStandingCalculations: Number(
      row.active_tournament_standing_calculations
    ),
    seedCalculationFinalizations: Number(row.seed_calculation_finalizations),
    activeSeedCalculations: Number(row.active_seed_calculations),
    bracketPublications: Number(row.bracket_publications),
    activeBrackets: Number(row.active_brackets),
    bracketResolutions: Number(row.bracket_resolutions),
    activeBracketResolutions: Number(row.active_bracket_resolutions),
    bracketAdvancements: Number(row.bracket_advancements),
    projectionVersions: Number(row.projection_versions),
    tournamentProjectionPayloads: Number(row.tournament_projection_payloads),
    matchProjectionPayloads: Number(row.match_projection_payloads),
    projectionActivations: Number(row.projection_activations)
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
    schemaVersion: 2,
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

function requireLegacyTeam(plan: LegacyBackfillPlan, legacyTeamId: string) {
  const team = plan.teams.find((candidate) =>
    candidate.legacyTeamId === legacyTeamId
  );
  if (team === undefined) {
    throw new Error("Canonical legacy team mapping is missing.");
  }
  return team;
}

function requireLegacyPlayer(plan: LegacyBackfillPlan, legacyPlayerId: string) {
  const player = plan.players.find((candidate) =>
    candidate.legacyPlayerId === legacyPlayerId
  );
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

function requireBracketMatch(plan: LegacyBackfillPlan, bracketMatchId: string) {
  const match = flattenBracketMatches(plan).find(
    (candidate) => candidate.id === bracketMatchId
  );
  if (match === undefined) {
    throw new Error("Canonical legacy bracket match mapping is missing.");
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

function operationalId(plan: LegacyBackfillPlan, purpose: string): string {
  return createUuidV5(
    plan.tournament.id,
    `legacy-backfill-v2:${plan.sourceSnapshotVersion}:${purpose}`
  );
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
  "standingCalculationMatches",
  "standings",
  "podFinalizations",
  "podFinalizationProvenance",
  "seedCalculations",
  "seeds",
  "brackets",
  "bracketRounds",
  "bracketMatches",
  "bracketSlots",
  "scoringEvents",
  "shotAttempts",
  "shotClassifications",
  "statisticRuns",
  "statisticValues",
  "activeStatisticRuns",
  "activePodStandingCalculations",
  "activeTournamentStandingCalculations",
  "seedCalculationFinalizations",
  "activeSeedCalculations",
  "bracketPublications",
  "activeBrackets",
  "bracketResolutions",
  "activeBracketResolutions",
  "bracketAdvancements",
  "projectionVersions",
  "tournamentProjectionPayloads",
  "matchProjectionPayloads",
  "projectionActivations"
];

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original transaction failure.
  }
}
