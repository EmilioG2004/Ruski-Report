export interface DatabaseConfig {
  connectionString: string;
  ssl: boolean;
  sslRejectUnauthorized: boolean;
  maxConnections: number;
  connectionTimeoutMilliseconds: number;
  idleTimeoutMilliseconds: number;
  migrationsDirectory: string;
}

const defaultConnectionString =
  "postgresql://postgres:postgres@localhost:5432/ruski_report";

export function loadDatabaseConfig(
  environment: NodeJS.ProcessEnv = process.env
): DatabaseConfig {
  return {
    connectionString:
      environment.DATABASE_URL?.trim() || defaultConnectionString,
    ssl: readBoolean(environment.DATABASE_SSL, false),
    sslRejectUnauthorized: readBoolean(
      environment.DATABASE_SSL_REJECT_UNAUTHORIZED,
      true
    ),
    maxConnections: readPositiveInteger(environment.DATABASE_POOL_MAX, 10),
    connectionTimeoutMilliseconds: readPositiveInteger(
      environment.DATABASE_CONNECTION_TIMEOUT_MS,
      5_000
    ),
    idleTimeoutMilliseconds: readPositiveInteger(
      environment.DATABASE_IDLE_TIMEOUT_MS,
      30_000
    ),
    migrationsDirectory:
      environment.DATABASE_MIGRATIONS_DIR?.trim() ||
      `${process.cwd()}/migrations`
  };
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`Expected boolean environment value, received '${value}'.`);
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received '${value}'.`);
  }

  return parsed;
}
