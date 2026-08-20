import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadDatabaseConfig } from "../config/database.config";
import { PostgresTournamentReadRepository } from "../repositories/postgres";
import { MigrationRunner } from "./migration-runner";
import { PostgresDatabase } from "./postgres-database";

const rehearsalDatabaseUrl = process.env.POPULATED_MIGRATION_DATABASE_URL;
const postgresDescribe = rehearsalDatabaseUrl === undefined
  ? describe.skip
  : describe;

postgresDescribe("populated tournament-engine migration rehearsal", () => {
  let database: PostgresDatabase;
  const migrationsDirectory = join(process.cwd(), "migrations");

  beforeAll(() => {
    database = new PostgresDatabase(loadDatabaseConfig({
      DATABASE_URL: rehearsalDatabaseUrl,
      DATABASE_MIGRATIONS_DIR: migrationsDirectory
    }));
  });

  afterAll(async () => {
    await database.onApplicationShutdown();
  });

  it("upgrades populated 0006 state without changing legacy rows or reads", async () => {
    await applyMigrationsThrough0006(database, migrationsDirectory);
    await seedLegacySnapshot(database);
    const legacyDigestBefore = await digestLegacyTables(database);

    const config = loadDatabaseConfig({
      DATABASE_URL: rehearsalDatabaseUrl,
      DATABASE_MIGRATIONS_DIR: migrationsDirectory
    });
    const applied = await new MigrationRunner(database, config).migrate();
    const legacyDigestAfter = await digestLegacyTables(database);

    expect(applied).toEqual([7]);
    expect(legacyDigestAfter).toBe(legacyDigestBefore);
    expect(await new MigrationRunner(database, config).migrate()).toEqual([]);

    const engineRows = await database.query<{ count: string }>(
      "SELECT count(*) FROM engine_tournaments"
    );
    expect(engineRows.rows[0]?.count).toBe("0");

    const reads = new PostgresTournamentReadRepository(database);
    const active = await reads.findActiveTournament();
    const match = await reads.findMatchDetail("legacy-match-2026");
    expect(active).toMatchObject({
      ok: true,
      value: {
        id: "tournament-2026",
        year: 2026,
        status: "completed",
        version: 1
      }
    });
    expect(match).toMatchObject({
      ok: true,
      value: {
        id: "legacy-match-2026",
        tournamentId: "tournament-2026",
        status: "final"
      }
    });

    const comments = await database.query<{ match_id: string }>(
      "SELECT match_id FROM comments WHERE id = 'legacy-comment-2026'"
    );
    expect(comments.rows).toEqual([{ match_id: "legacy-match-2026" }]);
  });
});

async function applyMigrationsThrough0006(
  database: PostgresDatabase,
  migrationsDirectory: string
): Promise<void> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE schema_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    for (const filename of [
      "0001_initial_persistence.sql",
      "0002_account_authentication.sql",
      "0003_account_deletion.sql",
      "0004_comment_moderation.sql",
      "0005_comment_reporting.sql",
      "0006_user_blocking.sql"
    ]) {
      await client.query(await readFile(join(migrationsDirectory, filename), "utf8"));
      await client.query(
        "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
        [Number(filename.slice(0, 4)), filename]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedLegacySnapshot(database: PostgresDatabase): Promise<void> {
  const timestamp = "2026-08-01T00:00:00.000Z";
  await database.query(
    `INSERT INTO scorebook_sources (id, original_name, metadata)
     VALUES ('legacy-source-2026', 'sanitized-legacy.xlsx', '{"fixture":true}')`
  );
  await database.query(
    `INSERT INTO tournaments (id, game_type, year, name)
     VALUES ('tournament-2026', 'ruski', 2026, 'Sanitized Legacy Tournament')`
  );
  await database.query(
    `
      INSERT INTO tournament_snapshot_versions (
        tournament_id, version, status, format, active_match_ids,
        featured_match_ids, metadata, game_definition, validation, source_id,
        generated_at, published_at, updated_at
      ) VALUES (
        'tournament-2026', 1, 'completed',
        '{"type":"pod_and_bracket"}', ARRAY['legacy-match-2026'], '{}',
        '{"fixture":true}', '{}', '{"valid":true}', 'legacy-source-2026',
        $1, $1, $1
      )
    `,
    [timestamp]
  );
  await database.query(
    `INSERT INTO active_tournament_snapshots (
       tournament_id, snapshot_version, activated_at
     ) VALUES ('tournament-2026', 1, $1)`,
    [timestamp]
  );
  await database.query(
    `INSERT INTO match_identities (match_id, tournament_id, created_at)
     VALUES ('legacy-match-2026', 'tournament-2026', $1)`,
    [timestamp]
  );
  await database.query(
    `
      INSERT INTO matches (
        tournament_id, snapshot_version, match_id, sequence, game_type,
        status, participants, score, metadata, box_score, scorecard, events,
        domain_version, updated_at
      ) VALUES (
        'tournament-2026', 1, 'legacy-match-2026', 1, 'ruski', 'final',
        '[]', '{"participants":[],"isFinal":true}', '{}',
        '{"matchId":"legacy-match-2026","rows":[]}',
        '{"definition":{"columns":[]},"rows":[]}', '[]', 1, $1
      )
    `,
    [timestamp]
  );
  await database.query(
    `
      INSERT INTO comments (
        id, match_id, author_kind, author_display_name, body, created_at
      ) VALUES (
        'legacy-comment-2026', 'legacy-match-2026', 'guest',
        'Sanitized Guest', 'Sanitized fixture comment.', $1
      )
    `,
    [timestamp]
  );
}

async function digestLegacyTables(database: PostgresDatabase): Promise<string> {
  const tableResult = await database.query<{ tablename: string }>(
    `
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename <> 'schema_migrations'
        AND tablename NOT LIKE 'engine_%'
      ORDER BY tablename
    `
  );
  const hash = createHash("sha256");
  for (const { tablename } of tableResult.rows) {
    if (!/^[a-z_]+$/.test(tablename)) {
      throw new Error(`Unexpected legacy table name '${tablename}'.`);
    }
    hash.update(tablename);
    const rows = await database.query<{ value: string }>(
      `SELECT to_jsonb(row)::text AS value
       FROM ${tablename} row
       ORDER BY to_jsonb(row)::text`
    );
    for (const row of rows.rows) {
      hash.update(row.value);
    }
  }
  return hash.digest("hex");
}
