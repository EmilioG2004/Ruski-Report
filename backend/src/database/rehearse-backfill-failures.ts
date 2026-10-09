import { loadDatabaseConfig } from "../config/database.config";
import {
  BACKFILL_FAILURE_SCENARIOS,
  BackfillFailureRehearsalError,
  BackfillFailureScenario,
  runBackfillFailureRehearsal
} from "../tournament-engine/qualification/postgres-backfill-failures.rehearsal";
import { PostgresDatabase } from "./postgres-database";

const RESTORED_ACKNOWLEDGEMENT = "DISPOSABLE_RESTORED_COPY_ONLY";
const WRITE_ACKNOWLEDGEMENT =
  "I_ACKNOWLEDGE_THIS_IS_AN_ISOLATED_RESTORED_COPY";

interface RehearsalArguments {
  tournamentId: string;
  scenario: BackfillFailureScenario;
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const databaseUrl = requireEnvironment("DATABASE_URL");
  const expectedDatabaseName = requireSafetyAcknowledgement(databaseUrl);
  const config = loadDatabaseConfig();
  const database = new PostgresDatabase(config);

  try {
    const report = await runBackfillFailureRehearsal({
      database,
      expectedDatabaseName,
      legacyTournamentId: args.tournamentId,
      scenario: args.scenario
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await database.onApplicationShutdown();
  }
}

function parseArguments(args: readonly string[]): RehearsalArguments {
  const tournamentId = readArgument(args, "--tournament-id");
  const scenario = readArgument(args, "--scenario");
  if (!BACKFILL_FAILURE_SCENARIOS.includes(
    scenario as BackfillFailureScenario
  )) {
    throw new CommandInputError("INVALID_SCENARIO");
  }
  const supported = new Set(["--tournament-id", "--scenario"]);
  for (let index = 0; index < args.length; index += 1) {
    if (!supported.has(args[index])) {
      throw new CommandInputError("UNSUPPORTED_ARGUMENT");
    }
    index += 1;
  }
  return {
    tournamentId,
    scenario: scenario as BackfillFailureScenario
  };
}

function readArgument(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (
    value === undefined ||
    value.trim().length === 0 ||
    value.startsWith("--") ||
    args.lastIndexOf(name) !== index
  ) {
    throw new CommandInputError("INVALID_ARGUMENTS");
  }
  return value.trim();
}

function requireSafetyAcknowledgement(databaseUrl: string): string {
  if (
    process.env.RUSKI_QUALIFICATION_RESTORED_ACK !== RESTORED_ACKNOWLEDGEMENT ||
    process.env.RUSKI_QUALIFICATION_RESTORED_WRITE_ACK !== WRITE_ACKNOWLEDGEMENT
  ) {
    throw new CommandInputError("REHEARSAL_NOT_ACKNOWLEDGED");
  }
  const restoredDatabaseUrl = requireEnvironment(
    "RUSKI_QUALIFICATION_RESTORED_DATABASE_URL"
  );
  const expectedHost = requireEnvironment(
    "RUSKI_QUALIFICATION_EXPECTED_DATABASE_HOST"
  );
  const expectedDatabaseName = requireEnvironment(
    "RUSKI_QUALIFICATION_EXPECTED_DATABASE_NAME"
  );
  const expectedUser = requireEnvironment(
    "RUSKI_QUALIFICATION_EXPECTED_DATABASE_USER"
  );
  if (
    normalizeUrl(databaseUrl) !== normalizeUrl(restoredDatabaseUrl) ||
    !isGeneratedRehearsalName(expectedHost) ||
    !isGeneratedRehearsalName(expectedDatabaseName) ||
    !isGeneratedRehearsalName(expectedUser)
  ) {
    throw new CommandInputError("DATABASE_NOT_DISPOSABLE");
  }
  let url: URL;
  try {
    url = new URL(restoredDatabaseUrl);
  } catch {
    throw new CommandInputError("DATABASE_URL_INVALID");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new CommandInputError("DATABASE_URL_INVALID");
  }
  if (url.searchParams.has("database") || url.searchParams.has("dbname")) {
    throw new CommandInputError("DATABASE_URL_INVALID");
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (
    url.hostname !== expectedHost ||
    decodeURIComponent(url.username) !== expectedUser ||
    databaseName !== expectedDatabaseName ||
    !isDisposableDatabaseName(databaseName) ||
    (url.port !== "" && url.port !== "5432") ||
    url.password.length < 32 ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new CommandInputError("DATABASE_NOT_DISPOSABLE");
  }
  return expectedDatabaseName;
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new CommandInputError("REQUIRED_ENVIRONMENT_MISSING");
  }
  return value;
}

function isDisposableDatabaseName(databaseName: string): boolean {
  return isGeneratedRehearsalName(databaseName) &&
    !["postgres", "template0", "template1", "ruski_report"].includes(
      databaseName.toLowerCase()
    );
}

function isGeneratedRehearsalName(value: string): boolean {
  return /^phase7-[a-z0-9]+-[a-z0-9-]{6,64}$/u.test(value);
}

function normalizeUrl(value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new CommandInputError("DATABASE_URL_INVALID");
  }
}

class CommandInputError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = CommandInputError.name;
  }
}

void main().catch((error: unknown) => {
  const errorCode = error instanceof BackfillFailureRehearsalError ||
    error instanceof CommandInputError
    ? error.code
    : "UNEXPECTED_FAILURE";
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    status: "failed",
    errorCode
  })}\n`);
  process.exitCode = 1;
});
