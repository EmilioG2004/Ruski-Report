import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { PoolClient } from "pg";

import { loadDatabaseConfig } from "../../config/database.config";
import { PostgresDatabase } from "../../database";

const databaseUrl = process.env.TEST_DATABASE_URL;
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;

postgresDescribe("tournament progression migration rehearsal", () => {
  let database: PostgresDatabase;

  beforeAll(() => {
    database = new PostgresDatabase(loadDatabaseConfig({ DATABASE_URL: databaseUrl }));
  });

  afterAll(async () => {
    await database.onApplicationShutdown();
  });

  it("adds progression state without rewriting legacy tournament history", async () => {
    const client = await database.connect();
    const schema = `progression_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}`);
      await applyMigrations(client, 10);
      const tournamentId = randomUUID();
      const now = "2034-01-01T00:00:00.000Z";
      await client.query(`
        INSERT INTO tournaments (id, game_type, year, name)
        VALUES ('legacy-progression', 'ruski', 2034, 'Legacy Progression')
      `);
      await client.query(`
        INSERT INTO engine_tournaments (
          id, public_key, game_type, year, name, lifecycle, visibility,
          row_version, created_at, updated_at, metadata
        ) VALUES (
          $1::uuid, 'legacy-progression', 'ruski', 2034, 'Legacy Progression',
          'draft_setup', 'private', 1, $2, $2, '{"legacyBackfill":true}'::jsonb
        )
      `, [tournamentId, now]);
      const before = await client.query(`
        SELECT id::text, lifecycle, row_version, metadata
        FROM engine_tournaments WHERE id = $1::uuid
      `, [tournamentId]);

      await client.query(await readFile(
        join(process.cwd(), "migrations/0011_tournament_progression.sql"),
        "utf8"
      ));
      expect(await client.query(`
        SELECT id::text, lifecycle, row_version, metadata
        FROM engine_tournaments WHERE id = $1::uuid
      `, [tournamentId])).toMatchObject({ rows: before.rows });
      const relations = await client.query<{ name: string | null }>(`
        SELECT to_regclass(name)::text AS name
        FROM unnest(ARRAY[
          'engine_active_pod_standing_calculations',
          'engine_global_seed_review_versions',
          'engine_active_seed_calculations',
          'engine_bracket_publications',
          'engine_bracket_match_resolutions',
          'engine_bracket_match_replacements'
        ]) AS name
      `);
      expect(relations.rows.every((row) => row.name !== null)).toBe(true);
      const workbookConstraint = await client.query<{
        condeferrable: boolean;
        condeferred: boolean;
      }>(`
        SELECT condeferrable, condeferred
        FROM pg_constraint
        WHERE conname =
          'engine_generated_workbook_sheets_tournament_id_match_id_fkey'
      `);
      expect(workbookConstraint.rows[0]).toEqual({
        condeferrable: true,
        condeferred: true
      });
      await expect(client.query(`
        UPDATE engine_tournaments
        SET lifecycle = 'completed', setup_published_at = $2
        WHERE id = $1::uuid
      `, [tournamentId, now])).resolves.toBeDefined();
      await expect(client.query(`
        UPDATE engine_tournaments SET lifecycle = 'pod_play'
        WHERE id = $1::uuid
      `, [tournamentId])).rejects.toThrow(/lifecycle/i);
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
    "0009_workbook_reconciliation.sql",
    "0010_canonical_scoring_statistics.sql"
  ];
  for (const filename of filenames.slice(0, through)) {
    await client.query(await readFile(join(process.cwd(), "migrations", filename), "utf8"));
  }
}
