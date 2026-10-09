import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { PoolClient } from "pg";

import { loadDatabaseConfig } from "../../../config/database.config";
import { PostgresDatabase } from "../../../database";

const databaseUrl = process.env.TEST_DATABASE_URL;
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;

postgresDescribe("workbook reconciliation migration rehearsal", () => {
  let database: PostgresDatabase;

  beforeAll(() => {
    database = new PostgresDatabase(loadDatabaseConfig({
      DATABASE_URL: databaseUrl
    }));
  });

  afterAll(async () => {
    await database.onApplicationShutdown();
  });

  it("upgrades populated 0008 state without changing engine or legacy rows", async () => {
    const client = await database.connect();
    const schema = `workbook_rehearsal_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}`);
      await applyMigrations(client, 1, 8);
      const fixture = await seedPreservedRows(client);
      const before = await readPreservedRows(client);

      await client.query(await readFile(
        join(process.cwd(), "migrations/0009_workbook_reconciliation.sql"),
        "utf8"
      ));

      expect(await readPreservedRows(client)).toEqual(before);
      const relations = await client.query<{ relation_name: string | null }>(`
        SELECT to_regclass(name)::text AS relation_name
        FROM unnest(ARRAY[
          'engine_generated_workbooks',
          'engine_generated_workbook_sheets',
          'engine_workbook_import_batches',
          'engine_workbook_import_observations',
          'engine_workbook_revision_candidates',
          'engine_workbook_revision_candidate_teams',
          'engine_workbook_revision_candidate_players',
          'engine_match_workbook_source_states',
          'engine_workbook_import_decisions'
        ]) AS name
      `);
      expect(relations.rows.every((row) => row.relation_name !== null)).toBe(true);
      const issueValidation = await client.query<{
        safe: boolean;
        unsafe: boolean;
      }>(`
        SELECT
          engine_workbook_validation_issues_are_safe($1::jsonb) AS safe,
          engine_workbook_validation_issues_are_safe($2::jsonb) AS unsafe
      `, [
        JSON.stringify([{
          code: "ASSIGNMENT_REQUIRED",
          severity: "error",
          message: "Choose a stable match.",
          path: "sheets[1]"
        }]),
        JSON.stringify([{
          code: "bad",
          severity: "private",
          message: { raw: "unsafe" }
        }])
      ]);
      expect(issueValidation.rows).toEqual([{ safe: true, unsafe: false }]);
      await client.query(`
        INSERT INTO engine_tournament_configurations (
          tournament_id, format_version, format_type, team_count, pod_count,
          pod_sizes, players_per_team, games_per_pair, qualifiers_per_pod,
          bracket_size, allow_byes, standings_rules
        ) VALUES (
          $1::uuid, 1, 'pod_and_single_elimination', 24, 1,
          ARRAY[24]::smallint[], 1, 1, 1, 2, true,
          ARRAY['record','cupDifferential','teamShootingPercentage',
                'administratorResolution']::text[]
        )
      `, [fixture.tournamentId]);
      await client.query("SAVEPOINT workbook_capacity_guard");
      await expect(client.query(`
        UPDATE engine_tournaments
        SET lifecycle = 'setup_published', setup_published_at = now(),
            row_version = row_version + 1
        WHERE id = $1::uuid
      `, [fixture.tournamentId])).rejects.toThrow(/game-sheet capacity/i);
      await client.query("ROLLBACK TO SAVEPOINT workbook_capacity_guard");
      await client.query(`
        INSERT INTO engine_generated_workbooks (
          id, tournament_id, generation_revision, workbook_schema_version,
          generation_kind, source_tournament_row_version, source_digest,
          artifact_digest, artifact_size_bytes, artifact, filename,
          generated_by_admin_id, generated_at
        ) VALUES (
          $1::uuid, $2::uuid, 1, 1,
          'setup', 1, repeat('a', 64),
          repeat('b', 64), 1, decode('00', 'hex'), 'rejected-source.xlsx',
          $3::uuid, now()
        )
      `, [fixture.workbookId, fixture.tournamentId, fixture.administratorId]);
      await client.query(`
        INSERT INTO engine_workbook_import_batches (
          id, tournament_id, workbook_id, workbook_schema_version,
          source_workbook_digest, source_size_bytes,
          base_tournament_row_version, preview_digest, status,
          recognized_sheet_count, proposed_sheet_count,
          unchanged_sheet_count, missing_sheet_count, invalid_sheet_count,
          received_by_admin_id, received_at, previewed_at, preview_expires_at,
          completed_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, 1,
          repeat('c', 64), 1,
          1, repeat('d', 64), 'preview_rejected',
          0, 0,
          0, 0, 0,
          $4::uuid, now(), now(), now() + interval '24 hours',
          now()
        )
      `, [
        randomUUID(),
        fixture.tournamentId,
        fixture.workbookId,
        fixture.administratorId
      ]);
      const uploadByteColumns = await client.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name IN (
            'engine_workbook_import_batches',
            'engine_workbook_import_observations'
          )
          AND data_type = 'bytea'
      `);
      expect(uploadByteColumns.rows).toEqual([{ count: "0" }]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

async function applyMigrations(
  client: PoolClient,
  first: number,
  last: number
): Promise<void> {
  const filenames = [
    "0001_initial_persistence.sql",
    "0002_account_authentication.sql",
    "0003_account_deletion.sql",
    "0004_comment_moderation.sql",
    "0005_comment_reporting.sql",
    "0006_user_blocking.sql",
    "0007_tournament_engine.sql",
    "0008_administrator_identity.sql"
  ];
  for (const filename of filenames.slice(first - 1, last)) {
    await client.query(await readFile(
      join(process.cwd(), "migrations", filename),
      "utf8"
    ));
  }
}

async function seedPreservedRows(client: PoolClient): Promise<{
  tournamentId: string;
  administratorId: string;
  workbookId: string;
}> {
  const tournamentId = randomUUID();
  const administratorId = randomUUID();
  await client.query(`
    INSERT INTO tournaments (id, game_type, year, name)
    VALUES ('migration-preserved', 'ruski', 2032, 'Preserved Tournament')
  `);
  await client.query(`
    INSERT INTO engine_tournaments (
      id, public_key, game_type, year, name, lifecycle, visibility,
      row_version, metadata
    ) VALUES (
      $1::uuid, 'migration-preserved', 'ruski', 2032,
      'Preserved Tournament', 'draft_setup', 'private', 1,
      '{"preserved":true}'::jsonb
    )
  `, [tournamentId]);
  await client.query(`
    INSERT INTO admin_accounts (
      id, login_name, normalized_login_name, display_name
    ) VALUES ($1::uuid, 'migration-admin', 'migration-admin', 'Migration Admin')
  `, [administratorId]);
  return { tournamentId, administratorId, workbookId: randomUUID() };
}

async function readPreservedRows(client: PoolClient): Promise<unknown> {
  const result = await client.query<{ rows: unknown }>(`
    SELECT jsonb_build_object(
      'legacy', (
        SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id)
        FROM tournaments row
      ),
      'engine', (
        SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id)
        FROM engine_tournaments row
      ),
      'administrators', (
        SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id)
        FROM admin_accounts row
      )
    ) AS rows
  `);
  return result.rows[0]?.rows;
}
