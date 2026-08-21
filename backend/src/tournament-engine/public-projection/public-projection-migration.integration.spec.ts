import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { PoolClient } from "pg";

import { loadDatabaseConfig } from "../../config/database.config";
import { PostgresDatabase } from "../../database";

const databaseUrl = process.env.POPULATED_MIGRATION_DATABASE_URL;
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;

postgresDescribe("canonical public projection migration rehearsal", () => {
  let database: PostgresDatabase;

  beforeAll(() => {
    database = new PostgresDatabase(loadDatabaseConfig({ DATABASE_URL: databaseUrl }));
  });

  afterAll(async () => {
    await database.onApplicationShutdown();
  });

  it("adds immutable payload storage without rewriting legacy projection history", async () => {
    const client = await database.connect();
    const schema = `public_projection_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}`);
      await applyMigrations(client);
      const tournamentId = randomUUID();
      const now = "2035-01-01T00:00:00.000Z";
      await client.query(`
        INSERT INTO tournaments (id, game_type, year, name)
        VALUES ('legacy-public-projection', 'ruski', 2035, 'Legacy Projection')
      `);
      await client.query(`
        INSERT INTO engine_tournaments (
          id, public_key, game_type, year, name, lifecycle, visibility,
          row_version, created_at, updated_at, metadata
        ) VALUES (
          $1::uuid, 'legacy-public-projection', 'ruski', 2035,
          'Legacy Projection', 'draft_setup', 'private', 7, $2, $2,
          '{"preserved":true}'::jsonb
        )
      `, [tournamentId, now]);
      await client.query(`
        INSERT INTO engine_projection_versions (
          tournament_id, version, status, payload_schema_version,
          source_digest, created_at, ready_at, activated_at, metadata
        ) VALUES (
          $1::uuid, 3, 'active', 1, $2, $3, $3, $3,
          '{"legacy":true}'::jsonb
        )
      `, [tournamentId, "a".repeat(64), now]);
      await client.query(`
        INSERT INTO engine_active_projection_versions (
          tournament_id, projection_version, activated_at
        ) VALUES ($1::uuid, 3, $2)
      `, [tournamentId, now]);
      const before = await preservedRows(client, tournamentId);
      const beforeDigest = digestRows(before);
      await client.query("SAVEPOINT before_public_projection_migration");

      await client.query(await readFile(
        join(process.cwd(), "migrations/0012_public_projection.sql"),
        "utf8"
      ));
      await client.query(`
        UPDATE engine_active_projection_versions
        SET activated_at = activated_at
        WHERE tournament_id = $1::uuid
      `, [tournamentId]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");

      expect(await preservedRows(client, tournamentId)).toEqual(before);
      expect(digestRows(await preservedRows(client, tournamentId))).toBe(beforeDigest);
      const relations = await client.query<{ name: string | null }>(`
        SELECT to_regclass(name)::text AS name
        FROM unnest(ARRAY[
          'engine_public_tournament_projection_payloads',
          'engine_public_match_projection_payloads',
          'engine_public_projection_activations'
        ]) AS name
      `);
      expect(relations.rows.every((row) => row.name !== null)).toBe(true);
      expect(await client.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM engine_public_tournament_projection_payloads
      `)).toMatchObject({ rows: [{ count: "0" }] });

      await client.query("ROLLBACK TO SAVEPOINT before_public_projection_migration");
      expect(digestRows(await preservedRows(client, tournamentId))).toBe(beforeDigest);
      expect(await client.query<{ name: string | null }>(`
        SELECT to_regclass('engine_public_tournament_projection_payloads')::text
          AS name
      `)).toMatchObject({ rows: [{ name: null }] });
      await client.query(await readFile(
        join(process.cwd(), "migrations/0012_public_projection.sql"),
        "utf8"
      ));
      expect(digestRows(await preservedRows(client, tournamentId))).toBe(beforeDigest);

      await expect(client.query(`
        INSERT INTO engine_public_tournament_projection_payloads (
          tournament_id, projection_version, tournament_public_key,
          visibility, lifecycle, year, tournament_summary, tournament_detail,
          tournament_summary_digest, tournament_detail_digest, match_count,
          source_tournament_row_version, source_pointers, created_at
        ) VALUES (
          $1::uuid, 3, 'legacy-public-projection', 'private', 'draft_setup', 2035,
          '{}'::jsonb, '{}'::jsonb, $2, $2, 0, 7, '{}'::jsonb, $3
        )
      `, [tournamentId, "b".repeat(64), now])).rejects.toThrow(/only while building/i);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

async function applyMigrations(client: PoolClient): Promise<void> {
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
    "0010_canonical_scoring_statistics.sql",
    "0011_tournament_progression.sql"
  ];
  for (const filename of filenames) {
    await client.query(await readFile(
      join(process.cwd(), "migrations", filename),
      "utf8"
    ));
  }
}

function digestRows(rows: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

async function preservedRows(client: PoolClient, tournamentId: string) {
  return (await client.query(`
    SELECT tournament.id::text, tournament.row_version,
           tournament.metadata, projection.version, projection.status,
           projection.payload_schema_version, projection.source_digest,
           projection.metadata AS projection_metadata,
           active.projection_version
    FROM engine_tournaments tournament
    JOIN engine_projection_versions projection
      ON projection.tournament_id = tournament.id
    JOIN engine_active_projection_versions active
      ON active.tournament_id = tournament.id
    WHERE tournament.id = $1::uuid
  `, [tournamentId])).rows;
}
