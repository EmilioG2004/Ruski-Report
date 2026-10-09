import { loadDatabaseConfig } from "../config/database.config";
import { runLegacy2026Backfill } from "../tournament-engine/legacy";
import { PostgresDatabase } from "./postgres-database";

interface CheckpointEvidenceRow {
  protected_legacy_digest: string | null;
  correction_policy: string | null;
  correction_mismatch_count: string | null;
  correction_mismatch_digest: string | null;
}

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
    const checkpointEvidence = result.status === "applied" || result.status === "no_op"
      ? await readCheckpointEvidence(database, result.legacyTournamentId)
      : undefined;
    process.stdout.write(`${JSON.stringify({
      runId: result.runId,
      legacyTournamentId: result.legacyTournamentId,
      sourceSnapshotVersion: result.sourceSnapshotVersion,
      sourceDigest: result.sourceDigest,
      planDigest: result.planDigest,
      mappingDigest: result.mappingDigest,
      status: result.status,
      dryRun: result.dryRun,
      retryable: result.retryable,
      counts: result.counts,
      ...(checkpointEvidence === undefined ? {} : { checkpointEvidence }),
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

async function readCheckpointEvidence(
  database: PostgresDatabase,
  legacyTournamentId: string
): Promise<{
  protectedLegacyDigest: string;
  tournamentStatisticCorrections: {
    policy: "canonical_match_events_v1";
    mismatchCount: number;
    mismatchDigest: string;
  };
}> {
  const result = await database.query<CheckpointEvidenceRow>(
    `
      SELECT metadata ->> 'protectedLegacyDigest' AS protected_legacy_digest,
             metadata #>> '{tournamentStatisticCorrections,policy}'
               AS correction_policy,
             metadata #>> '{tournamentStatisticCorrections,mismatchCount}'
               AS correction_mismatch_count,
             metadata #>> '{tournamentStatisticCorrections,mismatchDigest}'
               AS correction_mismatch_digest
      FROM engine_legacy_backfill_runs
      WHERE legacy_tournament_id = $1 AND status = 'completed'
      ORDER BY completed_at DESC, id DESC
      LIMIT 1
    `,
    [legacyTournamentId]
  );
  const row = result.rows[0];
  const mismatchCount = Number(row?.correction_mismatch_count);
  if (
    row === undefined ||
    !isSha256(row.protected_legacy_digest) ||
    row.correction_policy !== "canonical_match_events_v1" ||
    !Number.isSafeInteger(mismatchCount) ||
    mismatchCount < 0 ||
    !isSha256(row.correction_mismatch_digest)
  ) {
    throw new Error("Completed legacy backfill checkpoint evidence is incomplete.");
  }
  return {
    protectedLegacyDigest: row.protected_legacy_digest,
    tournamentStatisticCorrections: {
      policy: row.correction_policy,
      mismatchCount,
      mismatchDigest: row.correction_mismatch_digest
    }
  };
}

function isSha256(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
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
