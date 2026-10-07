const ACKNOWLEDGEMENT = "DISPOSABLE_RESTORED_COPY_ONLY";

export function assertRestoredDatabaseTarget({
  databaseUrl,
  expectedHost,
  expectedDatabase,
  expectedUser,
  acknowledgement
}) {
  if (acknowledgement !== ACKNOWLEDGEMENT) {
    throw new Error("Restored-database rehearsal acknowledgement is missing.");
  }
  for (const [label, value] of Object.entries({
    expectedHost,
    expectedDatabase,
    expectedUser
  })) {
    if (!isGeneratedRehearsalName(value)) {
      throw new Error(`Expected ${label} is not a generated Phase 7 rehearsal name.`);
    }
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Restored-database rehearsal URL is invalid.");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("Restored-database rehearsal requires PostgreSQL.");
  }
  if (
    parsed.hostname !== expectedHost ||
    decodeURIComponent(parsed.username) !== expectedUser ||
    decodeURIComponent(parsed.pathname.slice(1)) !== expectedDatabase ||
    (parsed.port !== "" && parsed.port !== "5432")
  ) {
    throw new Error("Restored-database rehearsal URL does not match its isolated target.");
  }
  if (parsed.password.length < 32) {
    throw new Error("Restored-database rehearsal password is not ephemeral-strength.");
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Restored-database rehearsal URL cannot contain overrides.");
  }
  for (const forbidden of [
    "postgres", "ruski", "ruski_report", "production", "prod", "localhost",
    "127.0.0.1", "::1"
  ]) {
    if ([parsed.hostname, expectedDatabase, expectedUser].includes(forbidden)) {
      throw new Error("Restored-database rehearsal target resembles production.");
    }
  }
  return Object.freeze({
    host: expectedHost,
    database: expectedDatabase,
    user: expectedUser,
    port: 5432
  });
}

export function guardFromEnvironment(environment = process.env) {
  return assertRestoredDatabaseTarget({
    databaseUrl: environment.RUSKI_QUALIFICATION_RESTORED_DATABASE_URL,
    expectedHost: environment.RUSKI_QUALIFICATION_EXPECTED_DATABASE_HOST,
    expectedDatabase: environment.RUSKI_QUALIFICATION_EXPECTED_DATABASE_NAME,
    expectedUser: environment.RUSKI_QUALIFICATION_EXPECTED_DATABASE_USER,
    acknowledgement: environment.RUSKI_QUALIFICATION_RESTORED_ACK
  });
}

function isGeneratedRehearsalName(value) {
  return typeof value === "string" &&
    /^phase7-[a-z0-9]+-[a-z0-9-]{6,64}$/u.test(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    guardFromEnvironment();
    process.stdout.write("restored_database_guard=pass\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown guard failure.";
    process.stderr.write(`restored_database_guard=failed reason=${toReasonCode(message)}\n`);
    process.exitCode = 1;
  }
}

function toReasonCode(message) {
  return message.toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_|_$/gu, "");
}
