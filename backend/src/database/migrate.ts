import { loadDatabaseConfig } from "../config/database.config";
import { MigrationRunner } from "./migration-runner";
import { PostgresDatabase } from "./postgres-database";

async function migrate(): Promise<void> {
  const config = loadDatabaseConfig();
  const database = new PostgresDatabase(config);

  try {
    const versions = await new MigrationRunner(database, config).migrate();
    const summary = versions.length === 0
      ? "Database schema is current."
      : `Applied database migrations: ${versions.join(", ")}.`;
    process.stdout.write(`${summary}\n`);
  } finally {
    await database.onApplicationShutdown();
  }
}

void migrate().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Database migration failed: ${message}\n`);
  process.exitCode = 1;
});
