import { loadDatabaseConfig } from "../../config/database.config";
import { MigrationRunner } from "../../database/migration-runner";
import { PostgresDatabase } from "../../database/postgres-database";
import { PostgresTournamentReadRepository } from "../../repositories/postgres/postgres-tournament-read.repository";
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
      "TRUNCATE tournaments, scorebook_sources, user_accounts CASCADE"
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
    const second = await runLegacy2026Backfill({
      database,
      legacyTournamentId: source.legacyTournamentId
    });

    expect(applied).toMatchObject({ status: "applied", issues: [] });
    expect(second).toMatchObject({
      status: "no_op",
      sourceDigest: applied.sourceDigest,
      planDigest: applied.planDigest,
      mappingDigest: applied.mappingDigest,
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
      expect.objectContaining({ status: "completed", attempt_count: "3" })
    ]);
  });
});

interface RawMatchIdentity {
  match_id: string;
  tournament_id: string;
  created_at: string;
  xmin: string;
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
      INSERT INTO tournaments (id, game_type, year, name)
      VALUES ($1, $2, $3, $4)
    `,
    [source.legacyTournamentId, source.gameType, source.year, source.name]
  );
  await database.query(
    `
      INSERT INTO tournament_snapshot_versions (
        tournament_id, version, status, format, active_match_ids,
        featured_match_ids, bracket, metadata, game_definition, validation,
        source_id, generated_at, published_at, updated_at
      ) VALUES (
        $1, $2, $3, $4::jsonb, $5::text[], '{}'::text[], $6::jsonb,
        $7::jsonb, '{}'::jsonb, '{}'::jsonb, $8, $9, $9, $9
      )
    `,
    [
      source.legacyTournamentId,
      source.snapshotVersion,
      source.status,
      JSON.stringify(source.format),
      source.matches.map((match) => match.legacyMatchId),
      JSON.stringify(toLegacyBracket(source)),
      JSON.stringify(source.metadata),
      sourceId,
      source.snapshotPublishedAt
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
          $11::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 1, $12
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
            id, match_id, author_kind, author_display_name, body, created_at
          ) VALUES ($1, $2, 'guest', 'Synthetic Guest', 'Sanitized fixture', $3)
        `,
        [commentId, identity.legacyMatchId, source.snapshotPublishedAt]
      );
    }
    for (const reportId of identity.reportIds) {
      await database.query(
        `
          INSERT INTO comment_reports (
            id, comment_id, reported_comment_id, match_id, reason, status,
            created_at
          ) VALUES ($1, $2, $2, $3, 'other', 'open', $4)
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
