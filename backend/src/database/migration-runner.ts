import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PoolClient } from "pg";

import { DatabaseConfig } from "../config/database.config";
import { PostgresDatabase } from "./postgres-database";

interface Migration {
  version: number;
  name: string;
  sql: string;
}

export class MigrationRunner {
  constructor(
    private readonly database: PostgresDatabase,
    private readonly config: DatabaseConfig
  ) {}

  async migrate(): Promise<number[]> {
    const migrations = await loadMigrations(this.config.migrationsDirectory);
    const client = await this.database.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('ruski-report-schema-migrations'))"
      );
      await ensureMigrationTable(client);
      const appliedVersions = await readAppliedVersions(client);
      const pending = migrations.filter(
        (migration) => !appliedVersions.has(migration.version)
      );

      for (const migration of pending) {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
          [migration.version, migration.name]
        );
      }

      await client.query("COMMIT");
      return pending.map((migration) => migration.version);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function loadMigrations(directory: string): Promise<Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const migrations = await Promise.all(
    filenames.map(async (filename) => ({
      version: Number(filename.split("_", 1)[0]),
      name: filename,
      sql: await readFile(join(directory, filename), "utf8")
    }))
  );

  const versions = migrations.map((migration) => migration.version);
  if (new Set(versions).size !== versions.length) {
    throw new Error("Database migration versions must be unique.");
  }

  return migrations;
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function readAppliedVersions(client: PoolClient): Promise<Set<number>> {
  const result = await client.query<{ version: number }>(
    "SELECT version FROM schema_migrations"
  );
  return new Set(result.rows.map((row) => row.version));
}
