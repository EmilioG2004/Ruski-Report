import {
  PostgresFullLifecycleRehearsalInput,
  RehearsalFailure,
  runPostgresFullLifecycleRehearsal
} from "../tournament-engine/qualification/postgres-full-lifecycle.rehearsal";

const WRITE_ACKNOWLEDGEMENT =
  "I_ACKNOWLEDGE_THIS_IS_AN_ISOLATED_RESTORED_COPY";
const SAFE_DATABASE_NAME =
  /(?:^|[_-])(?:restore|restored|rehearsal|qualification)(?:[_-]|$)/u;
const SYSTEM_DATABASES = new Set(["postgres", "template0", "template1"]);

async function main(): Promise<void> {
  const input = qualificationInput(process.env);
  const summary = await runPostgresFullLifecycleRehearsal(input);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

function qualificationInput(
  environment: NodeJS.ProcessEnv
): PostgresFullLifecycleRehearsalInput {
  requireCondition(
    environment.RUSKI_QUALIFICATION_RESTORED_WRITE_ACK ===
      WRITE_ACKNOWLEDGEMENT,
    "restored_write_ack_missing"
  );
  const databaseUrl = required(
    environment,
    "RUSKI_QUALIFICATION_RESTORED_DATABASE_URL",
    "restored_database_url_missing"
  );
  const expectedDatabaseName = required(
    environment,
    "RUSKI_QUALIFICATION_EXPECTED_DATABASE_NAME",
    "expected_database_name_missing"
  );
  const administratorId = required(
    environment,
    "RUSKI_QUALIFICATION_ADMINISTRATOR_ID",
    "administrator_id_missing"
  );
  const legacyTournamentId = required(
    environment,
    "RUSKI_QUALIFICATION_LEGACY_TOURNAMENT_ID",
    "legacy_tournament_id_missing"
  );
  const candidateCommitSha = required(
    environment,
    "RUSKI_QUALIFICATION_CANDIDATE_SHA",
    "candidate_sha_missing"
  );
  const restoredUrl = parsePostgresUrl(databaseUrl);
  requireCondition(
    restoredUrl.searchParams.get("database") === null &&
      restoredUrl.searchParams.get("dbname") === null,
    "database_name_query_parameter_rejected"
  );
  const databaseName = decodeDatabaseName(restoredUrl);
  requireCondition(
    databaseName === expectedDatabaseName,
    "database_url_name_mismatch"
  );
  requireCondition(
    SAFE_DATABASE_NAME.test(expectedDatabaseName) &&
      !SYSTEM_DATABASES.has(expectedDatabaseName.toLowerCase()),
    "database_name_not_restore_scoped"
  );
  const ordinaryDatabaseUrl = environment.DATABASE_URL?.trim();
  if (ordinaryDatabaseUrl) {
    requireCondition(
      normalizeUrl(ordinaryDatabaseUrl) === normalizeUrl(databaseUrl),
      "ordinary_database_url_conflicts"
    );
  }

  return {
    databaseUrl,
    expectedDatabaseName,
    administratorId,
    legacyTournamentId,
    candidateCommitSha
  };
}

function required(
  environment: NodeJS.ProcessEnv,
  key: string,
  evidenceCode: string
): string {
  const value = environment[key]?.trim();
  requireCondition(value !== undefined && value.length > 0, evidenceCode);
  return value;
}

function parsePostgresUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RehearsalFailure("restored_database_url_invalid");
  }
  requireCondition(
    parsed.protocol === "postgres:" || parsed.protocol === "postgresql:",
    "restored_database_protocol_invalid"
  );
  requireCondition(parsed.hostname.length > 0, "restored_database_host_missing");
  return parsed;
}

function decodeDatabaseName(url: URL): string {
  const encodedName = url.pathname.startsWith("/")
    ? url.pathname.slice(1)
    : url.pathname;
  requireCondition(
    encodedName.length > 0 && !encodedName.includes("/"),
    "restored_database_name_missing"
  );
  try {
    return decodeURIComponent(encodedName);
  } catch {
    throw new RehearsalFailure("restored_database_name_invalid");
  }
}

function normalizeUrl(value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new RehearsalFailure("ordinary_database_url_invalid");
  }
}

function requireCondition(
  condition: unknown,
  evidenceCode: string
): asserts condition {
  if (!condition) throw new RehearsalFailure(evidenceCode);
}

void main().catch((error: unknown) => {
  const evidenceCode = error instanceof RehearsalFailure
    ? error.evidenceCode
    : "unexpected_failure";
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    scope: "restored-database-full-lifecycle",
    status: "failed",
    evidenceCode
  })}\n`);
  process.exitCode = 1;
});
