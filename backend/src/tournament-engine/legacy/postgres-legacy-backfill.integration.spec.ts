import { loadDatabaseConfig } from "../../config/database.config";
import { MigrationRunner } from "../../database/migration-runner";
import { PostgresDatabase } from "../../database/postgres-database";
import { PostgresTournamentReadRepository } from "../../repositories/postgres/postgres-tournament-read.repository";
import type {
  CanonicalPublicMatch,
  CanonicalPublicTournament
} from "../public-projection/contracts";
import { LegacyBackfillPlanner } from "./legacy-backfill-planner";
import { runLegacy2026Backfill } from "./legacy-backfill.tool";
import { LegacyTournamentSource } from "./legacy-backfill.types";
import { PostgresLegacySnapshotReader } from "./postgres-legacy-snapshot.reader";
import { syntheticPopulatedLegacySource } from "./synthetic-legacy.fixture";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const postgresDescribe = testDatabaseUrl === undefined ? describe.skip : describe;

postgresDescribe("PostgreSQL 2026 legacy backfill rehearsal", () => {
  let database: PostgresDatabase;

  beforeAll(async () => {
    const config = loadDatabaseConfig({
      DATABASE_URL: testDatabaseUrl,
      DATABASE_MIGRATIONS_DIR: `${process.cwd()}/migrations`
    });
    database = new PostgresDatabase(config);
    await new MigrationRunner(database, config).migrate();
  });

  beforeEach(async () => {
    await database.query(
      "TRUNCATE engine_legacy_backfill_runs, engine_tournaments, " +
      "tournaments, scorebook_sources, user_accounts CASCADE"
    );
  });

  afterAll(async () => {
    await database.onApplicationShutdown();
  });

  it("dry-runs, applies atomically, and makes a deterministic second run a no-op", async () => {
    const source = syntheticPopulatedLegacySource();
    await seedLegacySource(database, source);
    const reader = new PostgresLegacySnapshotReader(database);
    const planner = new LegacyBackfillPlanner();
    const publicReads = new PostgresTournamentReadRepository(database);
    const publicBefore = await publicReads.findTournamentById(
      source.legacyTournamentId
    );
    if (!publicBefore.ok) {
      throw new Error("Synthetic legacy public read failed before backfill.");
    }
    const identitiesBefore = await readRawMatchIdentities(
      database,
      source.legacyTournamentId
    );
    const protectedRowsBefore = await readProtectedRowVersions(
      database,
      source.legacyTournamentId
    );
    const before = await reader.readActiveSnapshot(source.legacyTournamentId);
    if (before === null) {
      throw new Error("Synthetic active legacy snapshot was not stored.");
    }
    const beforeDigest = planner.plan(before).sourceDigest;

    const dryRun = await runLegacy2026Backfill({
      database,
      legacyTournamentId: source.legacyTournamentId,
      dryRun: true
    });
    const engineCountAfterDryRun = await database.query<{ count: string }>(
      "SELECT count(*) FROM engine_tournaments"
    );
    expect(dryRun.status).toBe("dry_run");
    expect(Number(engineCountAfterDryRun.rows[0]?.count)).toBe(0);

    const applied = await runLegacy2026Backfill({
      database,
      legacyTournamentId: source.legacyTournamentId
    });
    const protectedRowsAfter = await readProtectedRowVersions(
      database,
      source.legacyTournamentId
    );
    expect(protectedRowsAfter).toEqual(protectedRowsBefore);
    const second = await runLegacy2026Backfill({
      database,
      legacyTournamentId: source.legacyTournamentId
    });
    await database.query(
      `INSERT INTO comments (
         id, match_id, author_kind, author_display_name, body, created_at
       ) VALUES ($1, $2, 'guest', 'Synthetic Guest', 'Sanitized later comment', $3)`,
      [
        "synthetic-comment-after-backfill",
        "legacy-match-pod-a",
        "2026-06-23T00:00:00.000Z"
      ]
    );
    const afterCommunityWrite = await runLegacy2026Backfill({
      database,
      legacyTournamentId: source.legacyTournamentId
    });

    expect(applied).toMatchObject({ status: "applied", issues: [] });
    await assertPinnedSyntheticProjection(database);
    await expect(database.query(
      `
        WITH fake_run AS (
          INSERT INTO engine_legacy_backfill_runs (
            id, legacy_tournament_id, source_snapshot_version, tool_version,
            source_digest, status, started_at, counts, metadata
          ) VALUES (
            'ffffffff-ffff-4fff-8fff-000000000001'::uuid,
            $1, $2, 2, repeat('f', 64), 'running', $3,
            '{}'::jsonb, '{}'::jsonb
          ) RETURNING id
        ), source AS (
          SELECT resolution.*, fake_run.id AS fake_run_id
          FROM engine_bracket_match_resolutions resolution
          CROSS JOIN fake_run
          WHERE resolution.provenance_kind = 'legacy_backfill'
          ORDER BY resolution.id
          LIMIT 1
        )
        INSERT INTO engine_bracket_match_resolutions (
          id, tournament_id, bracket_match_id, match_id, revision_id,
          winner_team_id, resolution_type, match_status,
          confirmation_digest, resolved_by_admin_id, resolved_at, metadata,
          provenance_kind, legacy_backfill_run_id
        )
        SELECT 'ffffffff-ffff-4fff-8fff-000000000002'::uuid,
               tournament_id, bracket_match_id, match_id, revision_id,
               winner_team_id, resolution_type, match_status,
               confirmation_digest, NULL, resolved_at, metadata,
               'legacy_backfill', fake_run_id
        FROM source
      `,
      [
        source.legacyTournamentId,
        source.snapshotVersion,
        source.snapshotPublishedAt
      ]
    )).rejects.toThrow("Legacy bracket resolution provenance is invalid.");
    expect(second).toMatchObject({
      status: "no_op",
      sourceDigest: applied.sourceDigest,
      planDigest: applied.planDigest,
      mappingDigest: applied.mappingDigest,
      counts: applied.counts
    });
    expect(afterCommunityWrite).toMatchObject({
      status: "no_op",
      sourceDigest: applied.sourceDigest,
      planDigest: applied.planDigest,
      counts: applied.counts
    });
    const publicAfter = await publicReads.findTournamentById(
      source.legacyTournamentId
    );
    if (!publicAfter.ok) {
      throw new Error("Synthetic legacy public read failed after backfill.");
    }
    expect(publicAfter.value).toEqual(publicBefore.value);

    const storedTournament = await database.query<{
      lifecycle: string;
      visibility: string;
      setup_published_at: Date;
      row_version: string;
    }>(
      `
        SELECT lifecycle, visibility, setup_published_at, row_version::text
        FROM engine_tournaments
        WHERE public_key = $1
      `,
      [source.legacyTournamentId]
    );
    expect(storedTournament.rows).toEqual([
      expect.objectContaining({
        lifecycle: "completed",
        visibility: "public",
        row_version: "2"
      })
    ]);
    expect(storedTournament.rows[0]?.setup_published_at.toISOString()).toBe(
      source.snapshotPublishedAt
    );

    const releaseState = await database.query<{
      pod_standings: string;
      seed_pointers: string;
      bracket_pointers: string;
      resolution_pointers: string;
      statistic_pointers: string;
      projection_pointers: string;
      legacy_publications: string;
      legacy_resolutions: string;
      standing_authority: string;
      legacy_finalizations: string;
      legacy_advancements: string;
    }>(
      `
        SELECT
          (SELECT count(*) FROM engine_active_pod_standing_calculations
            WHERE tournament_id = $1::uuid)::text AS pod_standings,
          (SELECT count(*) FROM engine_active_seed_calculations
            WHERE tournament_id = $1::uuid)::text AS seed_pointers,
          (SELECT count(*) FROM engine_active_brackets
            WHERE tournament_id = $1::uuid)::text AS bracket_pointers,
          (SELECT count(*) FROM engine_active_bracket_match_resolutions
            WHERE tournament_id = $1::uuid)::text AS resolution_pointers,
          (SELECT count(*) FROM engine_active_tournament_statistic_runs
            WHERE tournament_id = $1::uuid)::text AS statistic_pointers,
          (SELECT count(*) FROM engine_active_projection_versions
            WHERE tournament_id = $1::uuid)::text AS projection_pointers,
          (SELECT count(*) FROM engine_bracket_publications
            WHERE tournament_id = $1::uuid
              AND provenance_kind = 'legacy_backfill'
              AND cumulative_workbook_id IS NULL
              AND published_by_admin_id IS NULL)::text AS legacy_publications,
          (SELECT count(*) FROM engine_bracket_match_resolutions
            WHERE tournament_id = $1::uuid
              AND provenance_kind = 'legacy_backfill'
              AND resolved_by_admin_id IS NULL)::text AS legacy_resolutions,
          (SELECT count(*) FROM engine_standing_calculation_matches
            WHERE tournament_id = $1::uuid
              AND revision_id IS NOT NULL
              AND statistic_run_id IS NOT NULL
              AND statistic_input_digest IS NOT NULL)::text AS standing_authority,
          (SELECT count(*) FROM engine_pod_finalization_provenance
            WHERE tournament_id = $1::uuid
              AND provenance_kind = 'legacy_backfill'
              AND finalized_by_admin_id IS NULL)::text AS legacy_finalizations,
          (SELECT count(*) FROM engine_bracket_advancements
            WHERE tournament_id = $1::uuid
              AND provenance_kind = 'legacy_backfill'
              AND advanced_by_admin_id IS NULL)::text AS legacy_advancements
      `,
      [new LegacyBackfillPlanner().plan(source).tournament.id]
    );
    expect(releaseState.rows).toEqual([{
      pod_standings: "2",
      seed_pointers: "1",
      bracket_pointers: "1",
      resolution_pointers: "3",
      statistic_pointers: "1",
      projection_pointers: "1",
      legacy_publications: "1",
      legacy_resolutions: "3",
      standing_authority: "1",
      legacy_finalizations: "2",
      legacy_advancements: "2"
    }]);
    expect(applied.counts).toMatchObject({
      scoringEvents: 5,
      shotAttempts: 4,
      shotClassifications: 2,
      statisticRuns: 5,
      standingCalculationMatches: 1,
      podFinalizationProvenance: 2,
      activePodStandingCalculations: 2,
      activeSeedCalculations: 1,
      activeBrackets: 1,
      activeBracketResolutions: 3,
      bracketAdvancements: 2,
      projectionVersions: 1,
      matchProjectionPayloads: 4
    });

    const compatibilityAttribution = await database.query<{
      player_public_key: string;
      attribution_method: string;
      scorecard_row_id: string;
    }>(
      `
        SELECT player.public_key AS player_public_key,
               event.metadata ->> 'attributionMethod' AS attribution_method,
               event.metadata ->> 'legacyScorecardRowId' AS scorecard_row_id
        FROM engine_match_events event
        JOIN engine_players player ON player.id = event.player_id
        WHERE event.metadata ->> 'legacyEventId' = 'pod-a-make'
      `
    );
    expect(compatibilityAttribution.rows).toEqual([{
      player_public_key: "legacy-player-a1",
      attribution_method: "scorecard_player_id",
      scorecard_row_id: "legacy-scorecard-pod-a-make"
    }]);

    const frozenSlots = await database.query<{
      slot_count: string;
      frozen_match_count: string;
    }>(
      `
        SELECT
          (SELECT count(*) FROM engine_match_slots)::text AS slot_count,
          (SELECT count(*) FROM engine_matches
            WHERE participants_frozen_at IS NOT NULL)::text
            AS frozen_match_count
      `
    );
    expect(frozenSlots.rows).toEqual([
      { slot_count: "8", frozen_match_count: "4" }
    ]);

    const publicKeys = await database.query<{ public_key: string }>(
      `SELECT public_key FROM engine_matches ORDER BY public_key`
    );
    expect(publicKeys.rows.map((row) => row.public_key)).toEqual(
      expect.arrayContaining(source.matchIdentities.map((match) => match.legacyMatchId))
    );
    const structuralMatch = publicKeys.rows.find((row) =>
      /^legacy_match_[0-9a-f]{32}$/.test(row.public_key)
    );
    expect(structuralMatch).toBeDefined();

    const identitiesAfter = await readRawMatchIdentities(
      database,
      source.legacyTournamentId
    );
    const originalIdentityIds = new Set(
      identitiesBefore.map((identity) => identity.match_id)
    );
    expect(
      identitiesAfter.filter((identity) =>
        originalIdentityIds.has(identity.match_id)
      )
    ).toEqual(identitiesBefore);
    expect(
      identitiesAfter.filter((identity) =>
        !originalIdentityIds.has(identity.match_id)
      )
    ).toEqual([
      expect.objectContaining({
        match_id: structuralMatch?.public_key,
        tournament_id: source.legacyTournamentId
      })
    ]);

    const realIdentityCount = await database.query<{ count: string }>(
      `
        SELECT count(*)
        FROM match_identities
        WHERE tournament_id = $1 AND match_id = ANY($2::text[])
      `,
      [
        source.legacyTournamentId,
        source.matchIdentities.map((match) => match.legacyMatchId)
      ]
    );
    expect(Number(realIdentityCount.rows[0]?.count)).toBe(
      source.matchIdentities.length
    );
    const compatibilityIdentityCount = await database.query<{ count: string }>(
      `
        SELECT count(*)
        FROM match_identities identity
        JOIN engine_matches engine_match
          ON engine_match.public_key = identity.match_id
        WHERE identity.tournament_id = $1
          AND engine_match.metadata ->> 'compatibilityIdentity' = 'true'
      `,
      [source.legacyTournamentId]
    );
    expect(Number(compatibilityIdentityCount.rows[0]?.count)).toBe(1);

    const after = await reader.readActiveSnapshot(source.legacyTournamentId);
    if (after === null) {
      throw new Error("Synthetic active legacy snapshot disappeared.");
    }
    expect(planner.plan(after).sourceDigest).toBe(beforeDigest);

    const checkpoint = await database.query<{
      status: string;
      attempt_count: string;
    }>(
      `
        SELECT status,
               jsonb_array_length(metadata -> 'attempts')::text AS attempt_count
        FROM engine_legacy_backfill_runs
        WHERE legacy_tournament_id = $1
      `,
      [source.legacyTournamentId]
    );
    expect(checkpoint.rows).toEqual([
      expect.objectContaining({ status: "completed", attempt_count: "4" })
    ]);
  });

  it("serializes concurrent applies into one apply and one no-op", async () => {
    const source = syntheticPopulatedLegacySource();
    await seedLegacySource(database, source);

    const results = await Promise.all([
      runLegacy2026Backfill({
        database,
        legacyTournamentId: source.legacyTournamentId
      }),
      runLegacy2026Backfill({
        database,
        legacyTournamentId: source.legacyTournamentId
      })
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "applied",
      "no_op"
    ]);
    const counts = await database.query<{
      tournaments: string;
      projections: string;
      completed_runs: string;
    }>(
      `SELECT
         (SELECT count(*) FROM engine_tournaments)::text AS tournaments,
         (SELECT count(*) FROM engine_active_projection_versions)::text
           AS projections,
         (SELECT count(*) FROM engine_legacy_backfill_runs
           WHERE status = 'completed')::text AS completed_runs`
    );
    expect(counts.rows).toEqual([{
      tournaments: "1",
      projections: "1",
      completed_runs: "1"
    }]);
  });

  it("records stale tournament summaries while keeping event-derived statistics", async () => {
    const source = syntheticPopulatedLegacySource();
    const staleRow = source.tournamentStatistics[0]?.rows[0];
    if (staleRow === undefined) {
      throw new Error("Synthetic tournament statistic fixture is missing.");
    }
    staleRow.metricValues.makes = 99;
    await seedLegacySource(database, source);

    const result = await runLegacy2026Backfill({
      database,
      legacyTournamentId: source.legacyTournamentId
    });

    expect(result).toMatchObject({ status: "applied", issues: [] });
    const checkpoint = await database.query<{
      policy: string;
      mismatch_count: string;
      mismatch_digest: string;
    }>(
      `
        SELECT
          metadata #>> '{tournamentStatisticCorrections,policy}' AS policy,
          metadata #>> '{tournamentStatisticCorrections,mismatchCount}'
            AS mismatch_count,
          metadata #>> '{tournamentStatisticCorrections,mismatchDigest}'
            AS mismatch_digest
        FROM engine_legacy_backfill_runs
        WHERE legacy_tournament_id = $1 AND status = 'completed'
      `,
      [source.legacyTournamentId]
    );
    expect(checkpoint.rows).toEqual([{
      policy: "canonical_match_events_v1",
      mismatch_count: "1",
      mismatch_digest: expect.stringMatching(/^[a-f0-9]{64}$/)
    }]);

    const projection = await database.query<{
      detail: CanonicalPublicTournament;
    }>(
      `
        SELECT payload.tournament_detail AS detail
        FROM engine_public_tournament_projection_payloads payload
        JOIN engine_active_projection_versions active
          ON active.tournament_id = payload.tournament_id
         AND active.projection_version = payload.projection_version
      `
    );
    expect(statisticValue(
      projection.rows[0]?.detail.statistics ?? [],
      null,
      "legacy-player-a1",
      "makes"
    )).toBe(1);
  });

  it("normalizes legacy player rows and playoff sides without weakening parity", async () => {
    const source = syntheticPopulatedLegacySource();
    const podMatch = source.matches.find((match) =>
      match.legacyMatchId === "legacy-match-pod-a"
    );
    const proxyPlayerRow = podMatch?.statistics.find((statistic) =>
      statistic.legacyPlayerId === "legacy-player-a1"
    );
    const playoffMatch = source.matches.find((match) =>
      match.legacyMatchId === "legacy-match-playoff-scored"
    );
    if (proxyPlayerRow === undefined || playoffMatch === undefined) {
      throw new Error("Synthetic legacy normalization fixture is incomplete.");
    }
    proxyPlayerRow.subjectType = "team";
    delete proxyPlayerRow.legacyPlayerId;
    proxyPlayerRow.metricValues.voms = 0;
    playoffMatch.participants.reverse();
    await seedLegacySource(database, source);

    const result = await runLegacy2026Backfill({
      database,
      legacyTournamentId: source.legacyTournamentId
    });

    expect(result).toMatchObject({ status: "applied", issues: [] });
    const projection = await database.query<{
      match_public_key: string;
      detail_payload: CanonicalPublicMatch;
    }>(
      `
        SELECT match_public_key, detail_payload
        FROM engine_public_match_projection_payloads
        ORDER BY match_public_key
      `
    );
    const matches = new Map(projection.rows.map((row) => [
      row.match_public_key,
      row.detail_payload
    ]));
    expect(boxScoreValue(
      matches.get("legacy-match-pod-a"),
      "legacy-player-a1",
      "makes"
    )).toBe(1);
    expect(matches.get("legacy-match-playoff-scored")?.participants.map(
      (participant) => ({
        side: participant.side,
        teamId: participant.team.id,
        seed: participant.seed
      })
    )).toEqual([
      { side: 1, teamId: "legacy-team-charlie", seed: 2 },
      { side: 2, teamId: "legacy-team-alpha", seed: 1 }
    ]);
  });

  it("rolls back every canonical artifact when equivalence fails", async () => {
    const source = syntheticPopulatedLegacySource();
    source.matches[0]?.statistics.push({
      subjectType: "player",
      legacyTeamId: "legacy-team-alpha",
      legacyPlayerId: "legacy-player-a1",
      metricValues: { makes: 99 }
    });
    await seedLegacySource(database, source);

    const result = await runLegacy2026Backfill({
      database,
      legacyTournamentId: source.legacyTournamentId
    });

    expect(result).toMatchObject({
      status: "failed",
      retryable: true,
      issues: [expect.objectContaining({ code: "LEGACY_BACKFILL_APPLY_FAILED" })]
    });
    const counts = await database.query<{
      tournaments: string;
      projections: string;
      legacy_matches: string;
    }>(
      `SELECT
         (SELECT count(*) FROM engine_tournaments)::text AS tournaments,
         (SELECT count(*) FROM engine_projection_versions)::text AS projections,
         (SELECT count(*) FROM matches WHERE tournament_id = $1)::text
           AS legacy_matches`,
      [source.legacyTournamentId]
    );
    expect(counts.rows).toEqual([{
      tournaments: "0",
      projections: "0",
      legacy_matches: String(source.matches.length)
    }]);
  });
});

interface RawMatchIdentity {
  match_id: string;
  tournament_id: string;
  created_at: string;
  xmin: string;
}

interface ProtectedRowVersion {
  table_name: string;
  row_key: string;
  row_version: string;
}

async function readProtectedRowVersions(
  database: PostgresDatabase,
  tournamentId: string
): Promise<ProtectedRowVersion[]> {
  const result = await database.query<ProtectedRowVersion>(
    `
      WITH match_keys AS (
        SELECT match_id FROM match_identities WHERE tournament_id = $1
      ), relevant_accounts AS (
        SELECT author_user_id AS user_id FROM comments
        WHERE match_id IN (SELECT match_id FROM match_keys)
        UNION
        SELECT reporter_user_id FROM comment_reports
        WHERE match_id IN (SELECT match_id FROM match_keys)
      )
      SELECT 'tournament_snapshot_versions' AS table_name,
             tournament_id || ':' || version::text AS row_key,
             xmin::text AS row_version
      FROM tournament_snapshot_versions WHERE tournament_id = $1
      UNION ALL SELECT 'upload_reports', id, xmin::text
      FROM upload_reports WHERE tournament_id = $1
      UNION ALL SELECT 'comments', id, xmin::text FROM comments
      WHERE match_id IN (SELECT match_id FROM match_keys)
      UNION ALL SELECT 'comment_reports', id, xmin::text FROM comment_reports
      WHERE match_id IN (SELECT match_id FROM match_keys)
      UNION ALL SELECT 'user_accounts', id, xmin::text FROM user_accounts
      WHERE id IN (SELECT user_id FROM relevant_accounts)
      UNION ALL SELECT 'local_account_credentials', user_id, xmin::text
      FROM local_account_credentials
      WHERE user_id IN (SELECT user_id FROM relevant_accounts)
      UNION ALL SELECT 'external_identities', provider || ':' || provider_subject,
             xmin::text FROM external_identities
      WHERE user_id IN (SELECT user_id FROM relevant_accounts)
      UNION ALL SELECT 'auth_sessions', id, xmin::text FROM auth_sessions
      WHERE user_id IN (SELECT user_id FROM relevant_accounts)
      UNION ALL SELECT 'user_blocks', blocker_user_id || ':' || blocked_user_id,
             xmin::text FROM user_blocks
      WHERE blocker_user_id IN (SELECT user_id FROM relevant_accounts)
         OR blocked_user_id IN (SELECT user_id FROM relevant_accounts)
      ORDER BY table_name, row_key
    `,
    [tournamentId]
  );
  return result.rows;
}

async function readRawMatchIdentities(
  database: PostgresDatabase,
  tournamentId: string
): Promise<RawMatchIdentity[]> {
  const result = await database.query<RawMatchIdentity>(
    `
      SELECT match_id, tournament_id, created_at::text, xmin::text
      FROM match_identities
      WHERE tournament_id = $1
      ORDER BY match_id
    `,
    [tournamentId]
  );
  return result.rows;
}

async function assertPinnedSyntheticProjection(
  database: PostgresDatabase
): Promise<void> {
  const tournamentResult = await database.query<{
    tournament_detail: CanonicalPublicTournament;
  }>(
    `
      SELECT payload.tournament_detail
      FROM engine_public_tournament_projection_payloads payload
      JOIN engine_active_projection_versions active
        ON active.tournament_id = payload.tournament_id
       AND active.projection_version = payload.projection_version
    `
  );
  const tournament = tournamentResult.rows[0]?.tournament_detail;
  if (tournament === undefined) {
    throw new Error("Pinned synthetic tournament projection is missing.");
  }
  expect(tournament.pods.map((pod) => ({
    id: pod.id,
    standingState: pod.standingState,
    standings: pod.standings.map((standing) => ({
      teamId: standing.team.id,
      rank: standing.rank,
      wins: standing.wins,
      losses: standing.losses,
      cupDifferential: standing.cupDifferential,
      shootingPercentage: standing.shootingPercentage
    }))
  }))).toEqual([
    {
      id: "legacy-pod-a",
      standingState: "finalized",
      standings: [
        {
          teamId: "legacy-team-alpha", rank: 1, wins: 1, losses: 0,
          cupDifferential: 3, shootingPercentage: 0.55
        },
        {
          teamId: "legacy-team-bravo", rank: 2, wins: 0, losses: 1,
          cupDifferential: -3, shootingPercentage: 0.45
        }
      ]
    },
    {
      id: "legacy-pod-b",
      standingState: "finalized",
      standings: [
        {
          teamId: "legacy-team-charlie", rank: 1, wins: 1, losses: 0,
          cupDifferential: 2, shootingPercentage: 0.55
        },
        {
          teamId: "legacy-team-delta", rank: 2, wins: 0, losses: 1,
          cupDifferential: -2, shootingPercentage: 0.45
        }
      ]
    }
  ]);
  expect(tournament.seeds.map((seed) => ({
    teamId: seed.team.id,
    calculatedSeed: seed.calculatedSeed,
    effectiveSeed: seed.effectiveSeed,
    overridden: seed.overridden
  }))).toEqual([
    { teamId: "legacy-team-alpha", calculatedSeed: 1, effectiveSeed: 1,
      overridden: false },
    { teamId: "legacy-team-charlie", calculatedSeed: 2, effectiveSeed: 2,
      overridden: false },
    { teamId: "legacy-team-delta", calculatedSeed: 3, effectiveSeed: 3,
      overridden: false },
    { teamId: "legacy-team-bravo", calculatedSeed: 4, effectiveSeed: 4,
      overridden: false }
  ]);
  expect(statisticValue(
    tournament.statistics,
    null,
    "legacy-player-a1",
    "makes"
  )).toBe(1);
  expect(statisticValue(
    tournament.statistics,
    "playoffs",
    "legacy-player-a-former",
    "makes"
  )).toBe(1);
  expect(statisticValue(
    tournament.statistics,
    "playoffs",
    "legacy-player-c1",
    "guys"
  )).toBe(1);

  expect(tournament.bracket?.rounds.map((round) => ({
    id: round.id,
    matches: round.matches.map((match) => ({
      id: match.id,
      matchId: match.matchId,
      winnerId: match.winner?.id ?? null,
      slots: match.slots.map((slot) => ({
        source: slot.source,
        teamId: "team" in slot ? slot.team?.id ?? null : null,
        seed: "seed" in slot ? slot.seed : null,
        sourceBracketMatchId: "sourceBracketMatchId" in slot
          ? slot.sourceBracketMatchId
          : null
      }))
    }))
  }))).toEqual([
    {
      id: "legacy-round-semis",
      matches: [
        {
          id: "legacy-bracket-semi-1",
          matchId: "legacy-match-playoff-scored",
          winnerId: "legacy-team-alpha",
          slots: [
            { source: "team", teamId: "legacy-team-alpha", seed: 1,
              sourceBracketMatchId: null },
            { source: "team", teamId: "legacy-team-charlie", seed: 2,
              sourceBracketMatchId: null }
          ]
        },
        {
          id: "legacy-bracket-semi-2",
          matchId: expect.stringMatching(/^legacy_match_[0-9a-f]{32}$/),
          winnerId: "legacy-team-delta",
          slots: [
            { source: "team", teamId: "legacy-team-delta", seed: 3,
              sourceBracketMatchId: null },
            { source: "team", teamId: "legacy-team-bravo", seed: 4,
              sourceBracketMatchId: null }
          ]
        }
      ]
    },
    {
      id: "legacy-round-final",
      matches: [{
        id: "legacy-bracket-final",
        matchId: "legacy-match-bracket-only-final",
        winnerId: "legacy-team-alpha",
        slots: [
          { source: "match_winner", teamId: "legacy-team-alpha", seed: 1,
            sourceBracketMatchId: "legacy-bracket-semi-1" },
          { source: "match_winner", teamId: "legacy-team-delta", seed: 3,
            sourceBracketMatchId: "legacy-bracket-semi-2" }
        ]
      }]
    }
  ]);

  const matchResult = await database.query<{
    match_public_key: string;
    detail_payload: CanonicalPublicMatch;
  }>(
    `
      SELECT payload.match_public_key, payload.detail_payload
      FROM engine_public_match_projection_payloads payload
      JOIN engine_active_projection_versions active
        ON active.tournament_id = payload.tournament_id
       AND active.projection_version = payload.projection_version
      ORDER BY payload.match_public_key
    `
  );
  const matches = new Map(matchResult.rows.map((row) => [
    row.match_public_key,
    row.detail_payload
  ]));
  const podMatch = matches.get("legacy-match-pod-a");
  expect(podMatch?.events.map((event) => ({
    sequence: event.sequence,
    type: event.type,
    teamId: event.teamId,
    playerId: event.playerId,
    outcome: event.details.outcome ?? null,
    classification: event.details.classification ?? null
  }))).toEqual([
    { sequence: 1, type: "shot_attempt", teamId: "legacy-team-alpha",
      playerId: "legacy-player-a1", outcome: "make", classification: null },
    { sequence: 2, type: "shot_attempt", teamId: "legacy-team-bravo",
      playerId: "legacy-player-b1", outcome: "miss", classification: "tri" },
    { sequence: 3, type: "vom", teamId: "legacy-team-alpha",
      playerId: "legacy-player-a2", outcome: null, classification: null }
  ]);
  expect(podMatch?.scorecard?.rows.map((row) => ({
    sequence: row.sequence,
    teamId: row.teamId,
    playerId: row.playerId,
    outcome: row.values.outcome,
    classification: row.values.classification
  }))).toEqual([
    { sequence: 1, teamId: "legacy-team-alpha", playerId: "legacy-player-a1",
      outcome: "make", classification: null },
    { sequence: 2, teamId: "legacy-team-bravo", playerId: "legacy-player-b1",
      outcome: "miss", classification: "tri" }
  ]);
  expect(boxScoreValue(podMatch, "legacy-player-a1", "makes")).toBe(1);
  expect(boxScoreValue(podMatch, "legacy-player-b1", "tris")).toBe(1);
  expect(boxScoreValue(podMatch, "legacy-player-a2", "voms")).toBe(1);

  const playoff = matches.get("legacy-match-playoff-scored");
  expect(playoff?.participants[0]?.players.map((player) => player.id)).toEqual([
    "legacy-player-a-former",
    "legacy-player-a2"
  ]);
  expect(boxScoreValue(playoff, "legacy-player-a-former", "makes")).toBe(1);
  const final = matches.get("legacy-match-bracket-only-final");
  expect(final).toMatchObject({
    status: "final",
    scoreAvailability: "unrecorded",
    events: [],
    boxScore: null,
    scorecard: null
  });
  expect(final?.participants.map((participant) => ({
    teamId: participant.team.id,
    score: participant.score,
    players: participant.players
  }))).toEqual([
    { teamId: "legacy-team-alpha", score: null, players: [] },
    { teamId: "legacy-team-delta", score: null, players: [] }
  ]);
}

function statisticValue(
  statistics: CanonicalPublicTournament["statistics"],
  stage: "playoffs" | null,
  subjectId: string,
  metric: string
): number | null | undefined {
  return statistics.find((statistic) =>
    statistic.scope === "tournament" && statistic.stage === stage &&
    statistic.subject?.id === subjectId
  )?.values[metric];
}

function boxScoreValue(
  match: CanonicalPublicMatch | undefined,
  subjectId: string,
  metric: string
): number | null | undefined {
  return match?.boxScore?.rows.find((row) =>
    row.subject.id === subjectId
  )?.values[metric];
}

async function seedLegacySource(
  database: PostgresDatabase,
  source: LegacyTournamentSource
): Promise<void> {
  const sourceId = "synthetic-scorebook-source";
  await database.query(
    `INSERT INTO scorebook_sources (id, original_name, metadata)
     VALUES ($1, $2, $3::jsonb)`,
    [sourceId, "synthetic-sanitized.xlsx", JSON.stringify({ fixture: true })]
  );
  await database.query(
    `
      INSERT INTO user_accounts (
        id, display_name, normalized_display_name, provider, created_at, updated_at
      ) VALUES
        ('synthetic-account-author', 'Synthetic Author', 'synthetic author',
         'local_account', $1, $1),
        ('synthetic-account-reporter', 'Synthetic Reporter', 'synthetic reporter',
         'game_center', $1, $1)
    `,
    [source.snapshotPublishedAt]
  );
  await database.query(
    `INSERT INTO local_account_credentials (user_id, password_hash, updated_at)
     VALUES ('synthetic-account-author', 'sanitized-fixture-hash', $1)`,
    [source.snapshotPublishedAt]
  );
  await database.query(
    `
      INSERT INTO external_identities (
        user_id, provider, provider_subject, metadata, created_at
      ) VALUES (
        'synthetic-account-reporter', 'game_center',
        'synthetic-fixture-subject', '{"fixture":true}'::jsonb, $1
      )
    `,
    [source.snapshotPublishedAt]
  );
  await database.query(
    `
      INSERT INTO auth_sessions (
        id, user_id, token_hash, created_at, expires_at, last_seen_at
      ) VALUES
        ('synthetic-session-author', 'synthetic-account-author',
         'synthetic-fixture-token-author', $1, $1::timestamptz + interval '1 year', $1),
        ('synthetic-session-reporter', 'synthetic-account-reporter',
         'synthetic-fixture-token-reporter', $1, $1::timestamptz + interval '1 year', $1)
    `,
    [source.snapshotPublishedAt]
  );
  await database.query(
    `
      INSERT INTO user_blocks (blocker_user_id, blocked_user_id, created_at)
      VALUES ('synthetic-account-author', 'synthetic-account-reporter', $1)
    `,
    [source.snapshotPublishedAt]
  );
  await database.query(
    `
      INSERT INTO tournaments (id, game_type, year, name)
      VALUES ($1, $2, $3, $4)
    `,
    [source.legacyTournamentId, source.gameType, source.year, source.name]
  );
  await database.query(
    `
      INSERT INTO tournament_snapshot_versions (
        tournament_id, version, status, format, active_match_ids,
        featured_match_ids, bracket, statistics, metadata, game_definition,
        validation, source_id, generated_at, published_at, updated_at
      ) VALUES (
        $1, $2, $3, $4::jsonb, $5::text[], '{}'::text[], $6::jsonb,
        $7::jsonb, $8::jsonb, '{}'::jsonb, '{}'::jsonb, $9, $10, $10, $10
      )
    `,
    [
      source.legacyTournamentId,
      source.snapshotVersion,
      source.status,
      JSON.stringify(source.format),
      source.matches.map((match) => match.legacyMatchId),
      JSON.stringify(toLegacyBracket(source)),
      JSON.stringify(toLegacyTournamentStatistics(source)),
      JSON.stringify(source.metadata),
      sourceId,
      source.snapshotPublishedAt
    ]
  );
  await database.query(
    `
      INSERT INTO tournament_snapshot_versions (
        tournament_id, version, status, format, active_match_ids,
        featured_match_ids, bracket, statistics, metadata, game_definition,
        validation, source_id, generated_at, published_at, updated_at
      ) VALUES (
        $1, $2, 'archived', $3::jsonb, '{}'::text[], '{}'::text[], NULL,
        '[]'::jsonb, $4::jsonb, '{}'::jsonb, '{}'::jsonb, $5,
        $6::timestamptz - interval '1 day',
        $6::timestamptz - interval '1 day',
        $6::timestamptz - interval '1 day'
      )
    `,
    [
      source.legacyTournamentId,
      source.snapshotVersion - 1,
      JSON.stringify(source.format),
      JSON.stringify({ fixture: true, historical: true }),
      sourceId,
      source.snapshotPublishedAt
    ]
  );
  await database.query(
    `
      INSERT INTO upload_reports (
        id, game_type, source_id, status, validation, tournament_id,
        snapshot_version, snapshot_published_at, previous_snapshot_version,
        received_at, completed_at, metadata
      ) VALUES (
        'synthetic-upload-report', $1, $2, 'published', '{}'::jsonb, $3,
        $4, $5, $6, $5, $5, '{"fixture":true}'::jsonb
      )
    `,
    [
      source.gameType,
      sourceId,
      source.legacyTournamentId,
      source.snapshotVersion,
      source.snapshotPublishedAt,
      source.snapshotVersion - 1
    ]
  );
  await database.query(
    `
      INSERT INTO active_tournament_snapshots (
        tournament_id, snapshot_version, activated_at
      ) VALUES ($1, $2, $3)
    `,
    [source.legacyTournamentId, source.snapshotVersion, source.snapshotPublishedAt]
  );

  for (const team of source.teams) {
    await database.query(
      `
        INSERT INTO teams (
          tournament_id, snapshot_version, team_id, name, sequence, seed
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        source.legacyTournamentId,
        source.snapshotVersion,
        team.legacyTeamId,
        team.name,
        team.sequence,
        JSON.stringify({ pod: team.podSeed, overall: team.overallSeed })
      ]
    );
  }
  for (const player of source.players) {
    await database.query(
      `
        INSERT INTO players (
          tournament_id, snapshot_version, player_id, display_name
        ) VALUES ($1, $2, $3, $4)
      `,
      [
        source.legacyTournamentId,
        source.snapshotVersion,
        player.legacyPlayerId,
        player.displayName
      ]
    );
  }
  for (const membership of source.rosterMemberships) {
    await database.query(
      `
        INSERT INTO team_players (
          tournament_id, snapshot_version, team_id, player_id, sequence
        ) VALUES ($1, $2, $3, $4, $5)
      `,
      [
        source.legacyTournamentId,
        source.snapshotVersion,
        membership.legacyTeamId,
        membership.legacyPlayerId,
        membership.sequence
      ]
    );
  }
  for (const identity of source.matchIdentities) {
    await database.query(
      `INSERT INTO match_identities (match_id, tournament_id, created_at)
       VALUES ($1, $2, $3)`,
      [identity.legacyMatchId, source.legacyTournamentId, source.snapshotPublishedAt]
    );
  }
  for (const pod of source.pods) {
    await database.query(
      `
        INSERT INTO pods (
          tournament_id, snapshot_version, pod_id, name, sequence
        ) VALUES ($1, $2, $3, $4, $5)
      `,
      [
        source.legacyTournamentId,
        source.snapshotVersion,
        pod.legacyPodId,
        pod.name,
        pod.sequence
      ]
    );
    for (const [index, teamId] of pod.legacyTeamIds.entries()) {
      await database.query(
        `
          INSERT INTO pod_teams (
            tournament_id, snapshot_version, pod_id, team_id, sequence
          ) VALUES ($1, $2, $3, $4, $5)
        `,
        [
          source.legacyTournamentId,
          source.snapshotVersion,
          pod.legacyPodId,
          teamId,
          index + 1
        ]
      );
    }
  }
  for (const match of source.matches) {
    await database.query(
      `
        INSERT INTO matches (
          tournament_id, snapshot_version, match_id, sequence, game_type,
          status, participants, score, pod_id, bracket_match_id, metadata,
          box_score, scorecard, events, domain_version, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10,
          $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, 1, $15
        )
      `,
      [
        source.legacyTournamentId,
        source.snapshotVersion,
        match.legacyMatchId,
        match.sequence,
        source.gameType,
        match.status,
        JSON.stringify(match.participants.map((participant) => ({
          teamId: participant.legacyTeamId,
          playerIds: participant.legacyPlayerIds,
          seed: participant.seed,
          score: participant.score,
          result: participant.result
        }))),
        JSON.stringify({
          participants: match.score.participants.map((score) => ({
            teamId: score.legacyTeamId,
            score: score.score
          })),
          winnerTeamId: match.score.legacyWinnerTeamId,
          isFinal: match.score.isFinal,
          metadata: match.score.availability === undefined
            ? undefined
            : { availability: match.score.availability }
        }),
        match.legacyPodId ?? null,
        match.legacyBracketMatchId ?? null,
        JSON.stringify({
          detailAvailability: match.detailAvailability === "unrecorded"
            ? "bracket-only"
            : undefined
        }),
        JSON.stringify({
          matchId: match.legacyMatchId,
          gameType: source.gameType,
          rows: match.statistics.map((statistic) => ({
            subject: {
              type: statistic.subjectType,
              teamId: statistic.legacyTeamId,
              playerId: statistic.legacyPlayerId,
              label: statistic.legacyPlayerId ?? statistic.legacyTeamId ?? "subject"
            },
            stats: statistic.metricValues
          })),
          totals: {}
        }),
        JSON.stringify({
          definition: {
            id: "synthetic-scorecard",
            gameType: source.gameType,
            name: "Synthetic scorecard",
            columns: []
          },
          rows: match.scorecardRows.map((row, index) => ({
            id: row.legacyScorecardRowId,
            matchId: match.legacyMatchId,
            sequence: row.sequence,
            teamId: row.legacyTeamId,
            playerId: row.legacyPlayerId,
            eventIds: row.legacyEventIds,
            values: row.values
          }))
        }),
        JSON.stringify(match.events.map((event) => {
          const scorecard = match.scorecardRows.find((row) =>
            row.legacyEventIds.includes(event.legacyEventId)
          );
          return {
            id: event.legacyEventId,
            matchId: match.legacyMatchId,
            tournamentId: source.legacyTournamentId,
            gameType: source.gameType,
            type: event.type,
            sequence: event.sequence,
            occurredAt: event.occurredAt,
            phaseId: event.phase,
            teamId: event.legacyTeamId,
            playerId: event.legacyEventId === "pod-a-make"
              ? undefined
              : event.legacyPlayerId,
            metadata: {
              shooterName: scorecard?.values.shooter,
              turnNumber: event.turnNumber,
              teamTurnOrder: event.teamTurnOrder,
              shotInTeamTurn: event.shotInTeamTurn
            }
          };
        })),
        match.updatedAt
      ]
    );
  }
  for (const pod of source.pods) {
    for (const [index, matchId] of pod.legacyMatchIds.entries()) {
      await database.query(
        `
          INSERT INTO pod_matches (
            tournament_id, snapshot_version, pod_id, match_id, sequence
          ) VALUES ($1, $2, $3, $4, $5)
        `,
        [
          source.legacyTournamentId,
          source.snapshotVersion,
          pod.legacyPodId,
          matchId,
          index + 1
        ]
      );
    }
  }
  for (const standing of source.standings) {
    await database.query(
      `
        INSERT INTO standings (
          tournament_id, snapshot_version, standing_id, scope, team_id,
          pod_id, rank, record, games_played, points, metric_values
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb
        )
      `,
      [
        source.legacyTournamentId,
        source.snapshotVersion,
        standing.legacyStandingId,
        standing.scope,
        standing.legacyTeamId,
        standing.legacyPodId ?? null,
        standing.rank,
        JSON.stringify({ wins: standing.wins, losses: standing.losses }),
        standing.gamesPlayed,
        standing.points ?? null,
        JSON.stringify(standing.metricValues)
      ]
    );
  }
  for (const identity of source.matchIdentities) {
    for (const commentId of identity.commentIds) {
      await database.query(
        `
          INSERT INTO comments (
            id, match_id, author_kind, author_display_name, author_user_id,
            body, created_at
          ) VALUES (
            $1, $2, 'account', 'Synthetic Account',
            'synthetic-account-author', 'Sanitized fixture', $3
          )
        `,
        [commentId, identity.legacyMatchId, source.snapshotPublishedAt]
      );
    }
    for (const reportId of identity.reportIds) {
      await database.query(
        `
          INSERT INTO comment_reports (
            id, comment_id, reported_comment_id, match_id, reporter_user_id,
            reason, status, created_at
          ) VALUES (
            $1, $2, $2, $3, 'synthetic-account-reporter',
            'other', 'open', $4
          )
        `,
        [
          reportId,
          identity.commentIds[0] ?? `missing-${reportId}`,
          identity.legacyMatchId,
          source.snapshotPublishedAt
        ]
      );
    }
  }
}

function toLegacyTournamentStatistics(source: LegacyTournamentSource): unknown {
  return source.tournamentStatistics.map((table) => ({
    id: table.legacyTableId,
    scope: table.scope,
    subjectType: table.subjectType,
    rows: table.rows.map((row) => ({
      rank: row.rank,
      subject: {
        teamId: row.legacyTeamId,
        playerId: row.legacyPlayerId
      },
      values: row.metricValues
    }))
  }));
}

function toLegacyBracket(source: LegacyTournamentSource): unknown {
  if (source.bracket === undefined) {
    return null;
  }
  return {
    id: source.bracket.legacyBracketId,
    tournamentId: source.legacyTournamentId,
    name: source.bracket.name,
    rounds: source.bracket.rounds.map((round) => ({
      id: round.legacyRoundId,
      name: round.name,
      sequence: round.sequence,
      matches: round.matches.map((match) => ({
        id: match.legacyBracketMatchId,
        matchId: match.legacyMatchId,
        sequence: match.sequence,
        status: match.status,
        winnerTeamId: match.legacyWinnerTeamId,
        slots: match.slots.map((slot) => ({
          seed: slot.seed,
          teamId: slot.legacyTeamId,
          source: slot.sourceType === undefined
            ? undefined
            : {
                type: slot.sourceType,
                sourceMatchId: slot.legacySourceBracketMatchId,
                label: slot.label
              }
        }))
      }))
    }))
  };
}
