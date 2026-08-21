import { PoolClient } from "pg";

import { loadDatabaseConfig } from "../../config/database.config";
import {
  MigrationRunner,
  PostgresDatabase,
  PostgresTransactionManager
} from "../../database";
import {
  CanonicalScoringPostgresFixture,
  seedCanonicalScoringPostgresFixture,
  uuid
} from "../statistics/canonical-scoring-postgres.fixture";
import { PostgresCanonicalStatisticRepository } from "./postgres-canonical-statistic.repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;

postgresDescribe("canonical statistic PostgreSQL persistence", () => {
  let database: PostgresDatabase;
  let transactions: PostgresTransactionManager;
  let repository: PostgresCanonicalStatisticRepository;
  let fixture: CanonicalScoringPostgresFixture;

  beforeAll(async () => {
    const config = loadDatabaseConfig({
      DATABASE_URL: databaseUrl,
      DATABASE_MIGRATIONS_DIR: `${process.cwd()}/migrations`
    });
    database = new PostgresDatabase(config);
    await new MigrationRunner(database, config).migrate();
    transactions = new PostgresTransactionManager(database);
    repository = new PostgresCanonicalStatisticRepository(database);
  });

  beforeEach(async () => {
    await database.query("TRUNCATE engine_tournaments CASCADE");
    await database.query(
      "DELETE FROM match_identities WHERE tournament_id = 'canonical-statistics'"
    );
    await database.query(
      "DELETE FROM tournaments WHERE id = 'canonical-statistics'"
    );
    await database.query(
      "DELETE FROM admin_accounts WHERE login_name = 'statistics-admin'"
    );
    fixture = await seedCanonicalScoringPostgresFixture(database);
  });

  afterAll(async () => {
    await database.onApplicationShutdown();
  });

  it("persists match runs and one active aggregate without colliding shared players", async () => {
    const result = await persistFixture(repository, transactions, fixture);

    expect(result.materialized).toHaveLength(2);
    expect(result.tournamentStatisticRunDigest).toMatch(/^[a-f0-9]{64}$/);
    const active = await database.query<{
      statistic_run_id: string;
      run_kind: string;
      rules_version: number;
    }>(`
      SELECT active.statistic_run_id::text, scope.run_kind, active.rules_version
      FROM engine_active_tournament_statistic_runs active
      JOIN engine_canonical_statistic_run_scopes scope
        ON scope.statistic_run_id = active.statistic_run_id
      WHERE active.tournament_id = $1::uuid
    `, [fixture.tournamentId]);
    expect(active.rows[0]).toEqual({
      statistic_run_id: result.tournamentStatisticRunId,
      run_kind: "tournament_aggregate",
      rules_version: 1
    });
    const sharedPlayer = await database.query<{
      metric: string;
      value: string;
    }>(`
      SELECT metric, value::text
      FROM engine_canonical_statistic_values
      WHERE statistic_run_id = $1::uuid
        AND scope = 'tournament'
        AND stage = 'all'
        AND subject_type = 'player'
        AND subject_id = $2::uuid
        AND metric IN ('attempts', 'cups_scored')
      ORDER BY metric
    `, [result.tournamentStatisticRunId, fixture.playerIds[0]]);
    expect(sharedPlayer.rows).toEqual([
      { metric: "attempts", value: "2" },
      { metric: "cups_scored", value: "3" }
    ]);
    const materializations = await database.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM engine_workbook_candidate_materializations
      WHERE tournament_id = $1::uuid
    `, [fixture.tournamentId]);
    expect(materializations.rows[0]?.count).toBe("2");
  });

  it("binds activation time to immutable run order and rejects pointer rollback", async () => {
    const first = await persistFixture(repository, transactions, fixture);
    const nextRunId = uuid(150);
    const nextCreatedAt = "2033-01-03T00:00:00.000Z";
    await insertAggregateRun(database, fixture, nextRunId, nextCreatedAt, "9");

    const advanced = await database.query<{ activated_at: Date }>(`
      UPDATE engine_active_tournament_statistic_runs
      SET statistic_run_id = $2::uuid, activated_at = '2099-01-01T00:00:00Z'
      WHERE tournament_id = $1::uuid
      RETURNING activated_at
    `, [fixture.tournamentId, nextRunId]);
    expect(advanced.rows[0]?.activated_at.toISOString()).toBe(nextCreatedAt);

    await expect(database.query(`
      UPDATE engine_active_tournament_statistic_runs
      SET statistic_run_id = $2::uuid, activated_at = '2100-01-01T00:00:00Z'
      WHERE tournament_id = $1::uuid
    `, [fixture.tournamentId, first.tournamentStatisticRunId]))
      .rejects.toThrow(/forward only/i);
  });

  it("rejects unrecognized metrics and incoherent statistic value shapes", async () => {
    const runId = uuid(151);
    await insertAggregateRun(
      database,
      fixture,
      runId,
      "2033-01-03T00:00:00.000Z",
      "8"
    );
    await expect(insertStatisticValue(database, fixture, runId, uuid(152), {
      metric: "invented_metric",
      numerator: 1,
      denominator: null,
      value: 1
    })).rejects.toThrow(/metric_valid/i);
    await expect(insertStatisticValue(database, fixture, runId, uuid(153), {
      metric: "makes",
      numerator: -1,
      denominator: null,
      value: -1
    })).rejects.toThrow(/value_shape_valid/i);
    await expect(insertStatisticValue(database, fixture, runId, uuid(154), {
      metric: "shooting_percentage",
      numerator: 0,
      denominator: 0,
      value: 0
    })).rejects.toThrow(/value_shape_valid/i);
    await expect(insertStatisticValue(database, fixture, runId, uuid(156), {
      metric: "misses",
      numerator: 1.5,
      denominator: null,
      value: 1.5
    })).rejects.toThrow(/value_shape_valid/i);
    await expect(insertStatisticValue(database, fixture, runId, uuid(157), {
      metric: "attempts",
      numerator: 1,
      denominator: null,
      value: null
    })).rejects.toThrow(/value_shape_valid/i);
    await expect(insertStatisticValue(database, fixture, runId, uuid(158), {
      metric: "shooting_percentage",
      numerator: 1,
      denominator: 2,
      value: null
    })).rejects.toThrow(/value_shape_valid/i);
    await expect(insertStatisticValue(database, fixture, runId, uuid(159), {
      metric: "shooting_percentage",
      numerator: 1,
      denominator: 3,
      value: 1 / 3
    })).resolves.toBeDefined();

    await expect(insertStatisticValue(database, fixture, runId, uuid(155), {
      metric: "cup_differential",
      numerator: -3,
      denominator: null,
      value: -3
    })).resolves.toBeDefined();
  });

  it.each([
    ["scheduled", "partial"],
    ["in_progress", "complete"],
    ["final", "partial"],
    ["forfeited", "complete"],
    ["cancelled", "not_started"],
    ["postponed", "partial"]
  ] as const)("rejects %s with %s score availability", async (status, availability) => {
    await expectDirectRevisionRejected(database, fixture, {
      ordinal: 160 + ["scheduled", "in_progress", "final", "forfeited",
        "cancelled", "postponed"].indexOf(status),
      status,
      availability,
      scores: [null, null],
      results: ["pending", "pending"]
    }, /status and score availability/i);
  });

  it("accepts the canonical non-scoring state projections", async () => {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const states = [
        ["scheduled", "not_started", ["pending", "pending"]],
        ["postponed", "not_started", ["pending", "pending"]],
        ["in_progress", "partial", ["pending", "pending"]],
        ["final", "unrecorded", ["pending", "pending"]],
        ["cancelled", "not_applicable", ["cancelled", "cancelled"]],
        ["forfeited", "not_applicable", ["win", "forfeited"]]
      ] as const;
      for (const [index, [status, availability, results]] of states.entries()) {
        await insertDirectRevision(client, fixture, {
          ordinal: 170 + index,
          status,
          availability,
          scores: availability === "partial" ? [0, 0] : [null, null],
          results
        });
      }
      await expect(client.query("SET CONSTRAINTS ALL IMMEDIATE"))
        .resolves.toBeDefined();
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it.each([
    [180, "scheduled", "not_started", [0, null], ["pending", "pending"],
      /scores must remain null/i],
    [181, "in_progress", "partial", [0, 0], ["win", "pending"],
      /pending team results/i],
    [182, "final", "complete", [1, 0], ["win", "loss"],
      /must equal canonical shot cup effects/i],
    [183, "cancelled", "not_applicable", [null, null], ["pending", "pending"],
      /two cancelled team results/i],
    [184, "forfeited", "not_applicable", [null, null], ["win", "loss"],
      /one winner and one forfeited team/i]
  ] as const)(
    "rejects inconsistent %s result and score projection",
    async (ordinal, status, availability, scores, results, expected) => {
      await expectDirectRevisionRejected(database, fixture, {
        ordinal,
        status,
        availability,
        scores,
        results
      }, expected);
    }
  );

  it("keeps statistic histories and workbook crosswalks immutable", async () => {
    const result = await persistFixture(repository, transactions, fixture);
    await expect(database.query(`
      UPDATE engine_canonical_statistic_values
      SET value = value + 1
      WHERE statistic_run_id = $1::uuid
    `, [result.tournamentStatisticRunId])).rejects.toThrow(/immutable/i);
    await expect(database.query(`
      UPDATE engine_workbook_candidate_materializations
      SET metadata = '{"changed":true}'::jsonb
      WHERE candidate_id = $1::uuid
    `, [fixture.candidateIds[0]])).rejects.toThrow(/immutable/i);
    await expect(database.query(`
      DELETE FROM engine_active_tournament_statistic_runs
      WHERE tournament_id = $1::uuid
    `, [fixture.tournamentId])).rejects.toThrow(/cannot be deleted/i);
  });

  it("rejects late player and event inserts into a consumed revision", async () => {
    await persistFixture(repository, transactions, fixture);
    await expect(database.query(`
      INSERT INTO engine_match_revision_players (
        tournament_id, revision_id, side_number, team_id, player_id,
        roster_membership_id, roster_slot, display_name_at_revision
      ) VALUES (
        $1::uuid, $2::uuid, 1, $3::uuid, $4::uuid, $5::uuid, 1, 'Late Player'
      )
    `, [fixture.tournamentId, fixture.revisionIds[0], fixture.teamIds[2],
      fixture.playerIds[2], fixture.membershipIds[2]]))
      .rejects.toThrow(/child artifacts are immutable/i);
    await expect(database.query(`
      INSERT INTO engine_match_events (
        id, tournament_id, revision_id, sequence, event_type,
        team_id, player_id, created_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 99, 'vom',
        $4::uuid, $5::uuid, $6
      )
    `, [uuid(192), fixture.tournamentId, fixture.revisionIds[0],
      fixture.teamIds[0], fixture.playerIds[0], fixture.now]))
      .rejects.toThrow(/child artifacts are immutable/i);
  });

  it("rejects direct SQL selecting a match run or invalid Ruski cup effect", async () => {
    const result = await persistFixture(repository, transactions, fixture);
    await expect(database.query(`
      UPDATE engine_active_tournament_statistic_runs
      SET statistic_run_id = $2::uuid
      WHERE tournament_id = $1::uuid
    `, [fixture.tournamentId, result.materialized[0]?.matchStatisticRunId]))
      .rejects.toThrow(/aggregate run/i);

    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await insertDirectRevision(client, fixture, {
        ordinal: 193,
        status: "in_progress",
        availability: "partial",
        scores: [0, 0],
        results: ["pending", "pending"]
      });
      await client.query(`
        INSERT INTO engine_match_events (
          id, tournament_id, revision_id, sequence, event_type,
          team_id, player_id, created_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, 99, 'shot_attempt',
          $4::uuid, $5::uuid, $6
        )
      `, [uuid(140), fixture.tournamentId, uuid(2_193),
        fixture.teamIds[0], fixture.playerIds[0], fixture.now]);
      await client.query(`
        INSERT INTO engine_shot_attempts (event_id, outcome, cup_delta)
        VALUES ($1::uuid, 'miss', 0)
      `, [uuid(140)]);
      await client.query(`
        INSERT INTO engine_shot_classifications (event_id, classification)
        VALUES ($1::uuid, 'tri')
      `, [uuid(140)]);
      await expect(client.query("SET CONSTRAINTS ALL IMMEDIATE"))
        .rejects.toThrow(/cup effect/i);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("rejects a correction that changes the frozen participant set", async () => {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const correctionId = uuid(141);
      await client.query(`
        INSERT INTO engine_match_revisions (
          id, tournament_id, match_id, public_key, revision_number,
          previous_revision_id, status, score_availability, reason,
          source_adapter, actor_id, correction_reason, created_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, 'changed-participants', 2,
          $4::uuid, 'final', 'complete', 'correction',
          'operator_correction', 'fixture', 'invalid fixture', $5
        )
      `, [correctionId, fixture.tournamentId, fixture.matchIds[0],
        fixture.revisionIds[0], fixture.now]);
      for (const [index, teamId] of [
        fixture.teamIds[0], fixture.teamIds[1]
      ].entries()) {
        await client.query(`
          INSERT INTO engine_match_revision_teams (
            tournament_id, revision_id, side_number, team_id, score,
            result, display_name_at_revision
          ) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, 0, 'pending', $5)
        `, [fixture.tournamentId, correctionId, index + 1, teamId,
          `Team ${index + 1}`]);
      }
      await client.query(`
        INSERT INTO engine_match_revision_players (
          tournament_id, revision_id, side_number, team_id, player_id,
          roster_membership_id, roster_slot, display_name_at_revision
        ) VALUES (
          $1::uuid, $2::uuid, 1, $3::uuid, $4::uuid, $5::uuid, 1, 'Player 1'
        )
      `, [fixture.tournamentId, correctionId, fixture.teamIds[0],
        fixture.playerIds[0], fixture.membershipIds[0]]);
      await expect(client.query("SET CONSTRAINTS ALL IMMEDIATE"))
        .rejects.toThrow(/preserve frozen/i);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

async function persistFixture(
  repository: PostgresCanonicalStatisticRepository,
  transactions: PostgresTransactionManager,
  fixture: CanonicalScoringPostgresFixture
) {
  return transactions.runInTransaction((transaction) =>
    repository.persistMaterializedBatchInTransaction({
      tournamentId: fixture.tournamentId,
      rulesVersion: 1,
      calculatedAt: fixture.now,
      materializations: fixture.matchIds.map((matchId, index) => ({
        matchId,
        revisionId: fixture.revisionIds[index],
        candidateId: fixture.candidateIds[index],
        confirmationDigest: fixture.confirmationDigest,
        adapterVersion: 1,
        materializedByAdminId: fixture.adminId,
        writerFencingToken: index + 1,
        materializedAt: fixture.now
      }))
    }, transaction)
  );
}

async function insertAggregateRun(
  database: PostgresDatabase,
  fixture: CanonicalScoringPostgresFixture,
  runId: string,
  createdAt: string,
  digestCharacter: string
): Promise<void> {
  await database.query(`
    INSERT INTO engine_statistic_runs (
      id, tournament_id, input_digest, rules_version, created_at
    ) VALUES ($1::uuid, $2::uuid, $3, 1, $4)
  `, [runId, fixture.tournamentId, digestCharacter.repeat(64), createdAt]);
  await database.query(`
    INSERT INTO engine_canonical_statistic_run_scopes (
      statistic_run_id, tournament_id, run_kind, rules_version, created_at
    ) VALUES ($1::uuid, $2::uuid, 'tournament_aggregate', 1, $3)
  `, [runId, fixture.tournamentId, createdAt]);
}

function insertStatisticValue(
  database: PostgresDatabase,
  fixture: CanonicalScoringPostgresFixture,
  runId: string,
  valueId: string,
  value: {
    metric: string;
    numerator: number;
    denominator: number | null;
    value: number | null;
  }
): Promise<unknown> {
  return database.query(`
    INSERT INTO engine_canonical_statistic_values (
      id, tournament_id, statistic_run_id, scope, stage,
      subject_type, subject_id, metric, numerator, denominator, value
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, 'tournament', 'all',
      'team', $4::uuid, $5, $6::numeric, $7::numeric, $8::numeric
    )
  `, [valueId, fixture.tournamentId, runId, fixture.teamIds[0],
    value.metric, value.numerator, value.denominator, value.value]);
}

type DirectRevisionStatus =
  | "scheduled"
  | "in_progress"
  | "final"
  | "forfeited"
  | "cancelled"
  | "postponed";
type DirectRevisionAvailability =
  | "not_started"
  | "partial"
  | "complete"
  | "unrecorded"
  | "not_applicable";
type DirectRevisionResult =
  | "pending"
  | "win"
  | "loss"
  | "cancelled"
  | "forfeited";

interface DirectRevisionInput {
  ordinal: number;
  status: DirectRevisionStatus;
  availability: DirectRevisionAvailability;
  scores: readonly [number | null, number | null];
  results: readonly [DirectRevisionResult, DirectRevisionResult];
}

async function expectDirectRevisionRejected(
  database: PostgresDatabase,
  fixture: CanonicalScoringPostgresFixture,
  input: DirectRevisionInput,
  expected: RegExp
): Promise<void> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await insertDirectRevision(client, fixture, input);
    await expect(client.query("SET CONSTRAINTS ALL IMMEDIATE"))
      .rejects.toThrow(expected);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function insertDirectRevision(
  client: PoolClient,
  fixture: CanonicalScoringPostgresFixture,
  input: DirectRevisionInput
): Promise<void> {
  const matchId = uuid(1_000 + input.ordinal);
  const revisionId = uuid(2_000 + input.ordinal);
  const matchPublicKey = `direct-state-${input.ordinal}`;
  await client.query(`
    INSERT INTO match_identities (match_id, tournament_id, created_at)
    VALUES ($1, 'canonical-statistics', $2)
  `, [matchPublicKey, fixture.now]);
  await client.query(`
    INSERT INTO engine_matches (
      id, tournament_id, public_key, stage, pod_id, sequence,
      status, score_availability, row_version, created_at, updated_at
    ) VALUES (
      $1::uuid, $2::uuid, $3, 'pod_play', $4::uuid, $5,
      $6, $7, 1, $8, $8
    )
  `, [matchId, fixture.tournamentId, matchPublicKey, fixture.podId,
    input.ordinal, input.status, input.availability, fixture.now]);
  await client.query(`
    INSERT INTO engine_match_revisions (
      id, tournament_id, match_id, public_key, revision_number,
      status, score_availability, reason, source_adapter, actor_id, created_at
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4, 1,
      $5, $6, 'operator_resolution', 'operator_correction', 'fixture', $7
    )
  `, [revisionId, fixture.tournamentId, matchId,
    `direct-revision-${input.ordinal}`, input.status, input.availability,
    fixture.now]);
  for (const sideIndex of [0, 1] as const) {
    await client.query(`
      INSERT INTO engine_match_revision_teams (
        tournament_id, revision_id, side_number, team_id,
        score, result, display_name_at_revision
      ) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7)
    `, [fixture.tournamentId, revisionId, sideIndex + 1,
      fixture.teamIds[sideIndex], input.scores[sideIndex],
      input.results[sideIndex], `Team ${sideIndex + 1}`]);
    await client.query(`
      INSERT INTO engine_match_revision_players (
        tournament_id, revision_id, side_number, team_id, player_id,
        roster_membership_id, roster_slot, display_name_at_revision
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6::uuid, 1, $7
      )
    `, [fixture.tournamentId, revisionId, sideIndex + 1,
      fixture.teamIds[sideIndex], fixture.playerIds[sideIndex],
      fixture.membershipIds[sideIndex], `Player ${sideIndex + 1}`]);
  }
}
