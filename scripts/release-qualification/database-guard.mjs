/**
 * Fails closed before any local qualification command can touch PostgreSQL.
 * Values are returned to the caller but are never copied into evidence output.
 */

const DATABASE_VARIABLES = [
  "TEST_DATABASE_URL",
  "POPULATED_MIGRATION_DATABASE_URL"
];

export function requireDisposableDatabasePair(environment = process.env) {
  const urls = DATABASE_VARIABLES.map((name) => [
    name,
    readPostgresUrl(environment[name], name)
  ]);

  if (databaseTargetKey(urls[0][1]) === databaseTargetKey(urls[1][1])) {
    throw new Error(
      "TEST_DATABASE_URL and POPULATED_MIGRATION_DATABASE_URL must identify " +
        "different disposable databases."
    );
  }

  return Object.fromEntries(urls.map(([name, url]) => [name, url.href]));
}

function readPostgresUrl(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required for local release qualification.`);
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL.`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${name} must use the postgres or postgresql scheme.`);
  }
  if (!isLocalPostgresEndpoint(url)) {
    throw new Error(`${name} must target a local disposable PostgreSQL server.`);
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (databaseName.length === 0) {
    throw new Error(`${name} must name a disposable database.`);
  }
  if (["postgres", "template0", "template1"].includes(databaseName)) {
    throw new Error(`${name} must not target a PostgreSQL system database.`);
  }
  if (!/(^|[_-])(test|testing|migration|rehearsal|qualification)([_-]|$)/iu
    .test(databaseName)) {
    throw new Error(
      `${name} database name must explicitly identify disposable test data.`
    );
  }
  return url;
}

function isLocalPostgresEndpoint(url) {
  if (url.searchParams.has("database") || url.searchParams.has("dbname")) {
    return false;
  }
  const queryHost = url.searchParams.get("host");
  if (queryHost !== null) {
    return queryHost.startsWith("/tmp/") ||
      queryHost.startsWith("/private/tmp/");
  }
  return normalizedHost(url.hostname) === "loopback";
}

function databaseTargetKey(url) {
  const queryHost = url.searchParams.get("host");
  const host = queryHost === null
    ? normalizedHost(url.hostname)
    : `socket:${queryHost.replace(/\/+$/u, "")}`;
  const port = url.searchParams.get("port") ?? url.port ?? "5432";
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  return `${host}|${port}|${databaseName}`;
}

function normalizedHost(hostname) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname)
    ? "loopback"
    : hostname;
}
