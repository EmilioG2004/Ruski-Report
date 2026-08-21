import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { PoolClient } from "pg";

import { loadDatabaseConfig } from "../../config/database.config";
import { PostgresDatabase } from "../../database";

const databaseUrl = process.env.TEST_DATABASE_URL;
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;

postgresDescribe("canonical scoring migration rehearsal", () => {
  let database: PostgresDatabase;

  beforeAll(() => {
    database = new PostgresDatabase(loadDatabaseConfig({ DATABASE_URL: databaseUrl }));
  });

  afterAll(async () => {
    await database.onApplicationShutdown();
  });

  it("upgrades populated 0009 history without materializing accepted candidates", async () => {
    const client = await database.connect();
    const schema = `canonical_scoring_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}`);
      await applyMigrations(client, 9);
      const fixture = await seedAppliedCandidate(client);
      const before = await preservedRows(client);

      await client.query(await readFile(
        join(process.cwd(), "migrations/0010_canonical_scoring_statistics.sql"),
        "utf8"
      ));
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");

      expect(await preservedRows(client)).toEqual(before);
      expect(await client.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM engine_workbook_candidate_materializations
      `)).toMatchObject({ rows: [{ count: "0" }] });
      const relations = await client.query<{ relation_name: string | null }>(`
        SELECT to_regclass(name)::text AS relation_name
        FROM unnest(ARRAY[
          'engine_canonical_statistic_run_scopes',
          'engine_canonical_statistic_values',
          'engine_active_tournament_statistic_runs',
          'engine_workbook_candidate_materializations'
        ]) AS name
      `);
      expect(relations.rows.every((row) => row.relation_name !== null)).toBe(true);
      await seedLegacyNullMembershipCorrections(client, fixture);
      expect(fixture.candidateId).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

async function applyMigrations(client: PoolClient, through: number): Promise<void> {
  const filenames = [
    "0001_initial_persistence.sql",
    "0002_account_authentication.sql",
    "0003_account_deletion.sql",
    "0004_comment_moderation.sql",
    "0005_comment_reporting.sql",
    "0006_user_blocking.sql",
    "0007_tournament_engine.sql",
    "0008_administrator_identity.sql",
    "0009_workbook_reconciliation.sql"
  ];
  for (const filename of filenames.slice(0, through)) {
    await client.query(await readFile(join(process.cwd(), "migrations", filename), "utf8"));
  }
}

async function seedAppliedCandidate(client: PoolClient): Promise<{
  candidateId: string;
  tournamentId: string;
  matchId: string;
  teamIds: readonly [string, string];
  playerIds: readonly [string, string];
}> {
  const ids = Array.from({ length: 18 }, () => randomUUID());
  const [
    tournamentId, podId, teamOneId, teamTwoId, playerOneId, playerTwoId,
    membershipOneId, membershipTwoId, matchId, adminId, workbookId, sheetId,
    batchId, observationId, candidateId, sourceStateCandidateId,
    decisionId, auditUnused
  ] = ids;
  void sourceStateCandidateId;
  void auditUnused;
  const now = "2032-01-01T00:00:00.000Z";
  await client.query(`
    INSERT INTO tournaments (id, game_type, year, name)
    VALUES ('migration-canonical', 'ruski', 2032, 'Canonical Migration')
  `);
  await client.query(`
    INSERT INTO engine_tournaments (
      id, public_key, game_type, year, name, lifecycle, visibility,
      row_version, setup_published_at, created_at, updated_at
    ) VALUES (
      $1::uuid, 'migration-canonical', 'ruski', 2032, 'Canonical Migration',
      'draft_setup', 'private', 1, NULL, $2, $2
    )
  `, [tournamentId, now]);
  await client.query(`
    INSERT INTO engine_pods (
      id, tournament_id, public_key, name, normalized_name, sequence
    ) VALUES ($1::uuid, $2::uuid, 'pod-1', 'Pod 1', 'pod 1', 1)
  `, [podId, tournamentId]);
  for (const [index, teamId] of [teamOneId, teamTwoId].entries()) {
    await client.query(`
      INSERT INTO engine_teams (
        id, tournament_id, public_key, name, normalized_name, sequence
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
    `, [teamId, tournamentId, `team-${index + 1}`, `Team ${index + 1}`,
      `team ${index + 1}`, index + 1]);
    await client.query(`
      INSERT INTO engine_pod_teams (tournament_id, pod_id, team_id, initial_seed)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
    `, [tournamentId, podId, teamId, index + 1]);
  }
  for (const [index, values] of [
    [playerOneId, membershipOneId, teamOneId],
    [playerTwoId, membershipTwoId, teamTwoId]
  ].entries()) {
    const [playerId, membershipId, teamId] = values;
    await client.query(`
      INSERT INTO engine_players (
        id, tournament_id, public_key, display_name, created_at
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5)
    `, [playerId, tournamentId, `player-${index + 1}`, `Player ${index + 1}`, now]);
    await client.query(`
      INSERT INTO engine_roster_memberships (
        id, tournament_id, public_key, team_id, player_id, roster_slot,
        opened_at, opened_by
      ) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, 1, $6, 'migration')
    `, [membershipId, tournamentId, `membership-${index + 1}`, teamId, playerId, now]);
  }
  await client.query(`
    INSERT INTO match_identities (match_id, tournament_id, created_at)
    VALUES ('migration-match', 'migration-canonical', $1)
  `, [now]);
  await client.query(`
    INSERT INTO engine_matches (
      id, tournament_id, public_key, stage, pod_id, sequence,
      status, score_availability, row_version, created_at, updated_at
    ) VALUES (
      $1::uuid, $2::uuid, 'migration-match', 'pod_play', $3::uuid, 1,
      'scheduled', 'not_started', 1, $4, $4
    )
  `, [matchId, tournamentId, podId, now]);
  for (const [index, teamId] of [teamOneId, teamTwoId].entries()) {
    await client.query(`
      INSERT INTO engine_match_slots (
        tournament_id, match_id, slot_number, source_type, team_id
      ) VALUES ($1::uuid, $2::uuid, $3, 'team', $4::uuid)
    `, [tournamentId, matchId, index + 1, teamId]);
  }
  await client.query(`
    UPDATE engine_tournaments
    SET lifecycle = 'setup_published', setup_published_at = $2, updated_at = $2
    WHERE id = $1::uuid
  `, [tournamentId, now]);
  await client.query(`
    INSERT INTO admin_accounts (
      id, login_name, normalized_login_name, display_name
    ) VALUES ($1::uuid, 'migration-admin', 'migration-admin', 'Migration Admin')
  `, [adminId]);
  await client.query(`
    INSERT INTO engine_generated_workbooks (
      id, tournament_id, generation_revision, workbook_schema_version,
      generation_kind, source_tournament_row_version, source_digest,
      artifact_digest, artifact_size_bytes, artifact, filename,
      generated_by_admin_id, generated_at
    ) VALUES (
      $1::uuid, $2::uuid, 1, 1, 'setup', 1, repeat('a',64),
      repeat('b',64), 1, decode('00','hex'), 'migration.xlsx', $3::uuid, $4
    )
  `, [workbookId, tournamentId, adminId, now]);
  await client.query(`
    INSERT INTO engine_generated_workbook_sheets (
      workbook_id, tournament_id, sheet_id, sheet_ordinal, sheet_kind,
      sheet_name, match_id, generated_match_row_version,
      side_one_team_id, side_two_team_id, participant_digest,
      baseline_fingerprint
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, 1, 'game', 'Game 1', $4::uuid, 1,
      $5::uuid, $6::uuid, repeat('c',64), repeat('d',64)
    )
  `, [workbookId, tournamentId, sheetId, matchId, teamOneId, teamTwoId]);
  await client.query(`
    INSERT INTO engine_workbook_import_batches (
      id, tournament_id, workbook_id, workbook_schema_version,
      source_workbook_digest, source_size_bytes, base_tournament_row_version,
      preview_digest, status, recognized_sheet_count, proposed_sheet_count,
      unchanged_sheet_count, missing_sheet_count, invalid_sheet_count,
      received_by_admin_id, received_at, previewed_at, preview_expires_at,
      confirmed_by_admin_id, confirmed_at, completed_at
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, 1, repeat('e',64), 1, 1,
      repeat('f',64), 'applied', 1, 1, 0, 0, 0,
      $4::uuid, $5, $5, $5::timestamptz + interval '24 hours',
      $4::uuid, $5, $5
    )
  `, [batchId, tournamentId, workbookId, adminId, now]);
  await client.query(`
    INSERT INTO engine_workbook_import_observations (
      id, tournament_id, batch_id, workbook_id, workbook_sheet_id,
      sheet_ordinal, match_id, observation_kind, assignment_source,
      disposition, fingerprint, base_match_row_version,
      base_source_state_version, source_envelope_schema_version,
      source_envelope_digest, source_envelope, validation_issues, observed_at
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      1, $6::uuid, 'present', 'stable_metadata', 'proposed', repeat('1',64),
      1, 0, 1, repeat('2',64), '{"fixture":true}'::jsonb, '[]'::jsonb, $7
    )
  `, [observationId, tournamentId, batchId, workbookId, sheetId, matchId, now]);
  await client.query(`
    INSERT INTO engine_workbook_revision_candidates (
      id, tournament_id, match_id, batch_id, observation_id,
      source_revision_number, fingerprint, participant_digest,
      proposed_status, proposed_score_availability, reason,
      requires_confirmation, envelope_schema_version, envelope_digest,
      envelope, base_match_row_version, base_source_state_version, created_at
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      1, repeat('1',64), repeat('c',64), 'in_progress', 'partial', 'initial',
      false, 1, repeat('3',64), '{"fixture":true}'::jsonb, 1, 0, $6
    )
  `, [candidateId, tournamentId, matchId, batchId, observationId, now]);
  for (const [index, values] of [
    [teamOneId, playerOneId, membershipOneId],
    [teamTwoId, playerTwoId, membershipTwoId]
  ].entries()) {
    const [teamId, playerId, membershipId] = values;
    await client.query(`
      INSERT INTO engine_workbook_revision_candidate_teams (
        tournament_id, candidate_id, side_number, team_id, display_name_at_import
      ) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5)
    `, [tournamentId, candidateId, index + 1, teamId, `Team ${index + 1}`]);
    await client.query(`
      INSERT INTO engine_workbook_revision_candidate_players (
        tournament_id, candidate_id, side_number, team_id, player_id,
        roster_membership_id, roster_slot, display_name_at_import
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6::uuid, 1, $7
      )
    `, [tournamentId, candidateId, index + 1, teamId, playerId,
      membershipId, `Player ${index + 1}`]);
  }
  await client.query(`
    INSERT INTO engine_match_workbook_source_states (
      tournament_id, match_id, active_candidate_id, active_fingerprint,
      participant_digest, source_batch_id, source_observation_id,
      row_version, updated_at
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, repeat('1',64), repeat('c',64),
      $4::uuid, $5::uuid, 1, $6
    )
  `, [tournamentId, matchId, candidateId, batchId, observationId, now]);
  await client.query(`
    INSERT INTO engine_workbook_import_decisions (
      id, tournament_id, batch_id, observation_id, match_id, candidate_id,
      decision, actor_kind, administrator_id, preview_digest, decided_at
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
      'accepted', 'administrator', $7::uuid, repeat('f',64), $8
    )
  `, [decisionId, tournamentId, batchId, observationId, matchId,
    candidateId, adminId, now]);
  return {
    candidateId,
    tournamentId,
    matchId,
    teamIds: [teamOneId, teamTwoId],
    playerIds: [playerOneId, playerTwoId]
  };
}

async function seedLegacyNullMembershipCorrections(
  client: PoolClient,
  fixture: Awaited<ReturnType<typeof seedAppliedCandidate>>
): Promise<void> {
  const revisionIds = [randomUUID(), randomUUID()] as const;
  for (const [revisionIndex, revisionId] of revisionIds.entries()) {
    await client.query(`
      INSERT INTO engine_match_revisions (
        id, tournament_id, match_id, public_key, revision_number,
        previous_revision_id, status, score_availability, reason,
        source_adapter, actor_id, correction_reason, created_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid,
        'scheduled', 'not_started', $7, 'legacy_backfill', 'migration', $8, now()
      )
    `, [revisionId, fixture.tournamentId, fixture.matchId,
      `legacy-null-${revisionIndex + 1}`, revisionIndex + 1,
      revisionIndex === 0 ? null : revisionIds[0],
      revisionIndex === 0 ? "legacy_backfill" : "correction",
      revisionIndex === 0 ? null : "Preserve a legacy null membership ledger."]);
    for (const [sideIndex, teamId] of fixture.teamIds.entries()) {
      await client.query(`
        INSERT INTO engine_match_revision_teams (
          tournament_id, revision_id, side_number, team_id, result,
          display_name_at_revision
        ) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, 'pending', $5)
      `, [fixture.tournamentId, revisionId, sideIndex + 1, teamId,
        `Team ${sideIndex + 1}`]);
      await client.query(`
        INSERT INTO engine_match_revision_players (
          tournament_id, revision_id, side_number, team_id, player_id,
          roster_membership_id, roster_slot, display_name_at_revision
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, NULL, 1, $6
        )
      `, [fixture.tournamentId, revisionId, sideIndex + 1, teamId,
        fixture.playerIds[sideIndex], `Player ${sideIndex + 1}`]);
    }
    await client.query(`
      UPDATE engine_matches
      SET active_revision_id = $3::uuid, participants_frozen_at = now(),
          row_version = row_version + 1, updated_at = now()
      WHERE tournament_id = $1::uuid AND id = $2::uuid
    `, [fixture.tournamentId, fixture.matchId, revisionId]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    if (revisionIndex === 0) {
      await client.query("SET CONSTRAINTS ALL DEFERRED");
    }
  }
  const active = await client.query<{ active_revision_id: string }>(`
    SELECT active_revision_id::text
    FROM engine_matches
    WHERE tournament_id = $1::uuid AND id = $2::uuid
  `, [fixture.tournamentId, fixture.matchId]);
  expect(active.rows[0]?.active_revision_id).toBe(revisionIds[1]);
}

async function preservedRows(client: PoolClient): Promise<unknown> {
  const result = await client.query<{ value: unknown }>(`
    SELECT jsonb_build_object(
      'candidate', (SELECT jsonb_agg(to_jsonb(row)) FROM engine_workbook_revision_candidates row),
      'state', (SELECT jsonb_agg(to_jsonb(row)) FROM engine_match_workbook_source_states row),
      'decision', (SELECT jsonb_agg(to_jsonb(row)) FROM engine_workbook_import_decisions row),
      'legacy', (SELECT jsonb_agg(to_jsonb(row)) FROM tournaments row)
    ) AS value
  `);
  return result.rows[0]?.value;
}
