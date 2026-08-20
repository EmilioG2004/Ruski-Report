import { loadDatabaseConfig } from "../config/database.config";
import { runLegacy2026Backfill } from "../tournament-engine/legacy";
import { PostgresDatabase } from "./postgres-database";

interface BackfillArguments {
  tournamentId: string;
  apply: boolean;
}

async function backfillLegacyTournament(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const database = new PostgresDatabase(loadDatabaseConfig());

  try {
    const result = await runLegacy2026Backfill({
      database,
      legacyTournamentId: args.tournamentId,
      dryRun: !args.apply
    });
    process.stdout.write(`${JSON.stringify({
      runId: result.runId,
      legacyTournamentId: result.legacyTournamentId,
      sourceSnapshotVersion: result.sourceSnapshotVersion,
      status: result.status,
      dryRun: result.dryRun,
      counts: result.counts,
      issues: result.issues.map((issue) => ({
        code: issue.code,
        message: issue.message
      }))
    }, null, 2)}\n`);

    if (result.status === "failed" || result.status === "mismatch") {
      process.exitCode = 1;
    }
  } finally {
    await database.onApplicationShutdown();
  }
}

function parseArguments(args: readonly string[]): BackfillArguments {
  const tournamentFlag = args.indexOf("--tournament-id");
  const tournamentId = tournamentFlag === -1
    ? undefined
    : args[tournamentFlag + 1];

  if (
    tournamentId === undefined ||
    tournamentId.trim().length === 0 ||
    tournamentId.startsWith("--")
  ) {
    throw new Error(
      "Legacy backfill requires --tournament-id. It dry-runs unless --apply is present."
    );
  }

  const supported = new Set(["--tournament-id", "--apply"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--tournament-id") {
      index += 1;
      continue;
    }
    if (!supported.has(argument)) {
      throw new Error(`Unsupported legacy backfill argument '${argument}'.`);
    }
  }

  return {
    tournamentId: tournamentId.trim(),
    apply: args.includes("--apply")
  };
}

void backfillLegacyTournament().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Legacy tournament backfill failed: ${message}\n`);
  process.exitCode = 1;
});
