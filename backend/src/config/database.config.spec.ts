import { loadDatabaseConfig } from "./database.config";

describe("database config", () => {
  it("uses local PostgreSQL defaults", () => {
    const config = loadDatabaseConfig({});

    expect(config).toMatchObject({
      connectionString:
        "postgresql://postgres:postgres@localhost:5432/ruski_report",
      ssl: false,
      sslRejectUnauthorized: true,
      maxConnections: 10,
      connectionTimeoutMilliseconds: 5_000,
      idleTimeoutMilliseconds: 30_000
    });
  });

  it("reads deployment settings from the environment", () => {
    const config = loadDatabaseConfig({
      DATABASE_URL: "postgresql://database.example/ruski",
      DATABASE_SSL: "true",
      DATABASE_SSL_REJECT_UNAUTHORIZED: "false",
      DATABASE_POOL_MAX: "4",
      DATABASE_CONNECTION_TIMEOUT_MS: "1500",
      DATABASE_IDLE_TIMEOUT_MS: "9000",
      DATABASE_MIGRATIONS_DIR: "/app/migrations"
    });

    expect(config).toEqual({
      connectionString: "postgresql://database.example/ruski",
      ssl: true,
      sslRejectUnauthorized: false,
      maxConnections: 4,
      connectionTimeoutMilliseconds: 1500,
      idleTimeoutMilliseconds: 9000,
      migrationsDirectory: "/app/migrations"
    });
  });

  it("rejects invalid pool settings", () => {
    expect(() =>
      loadDatabaseConfig({ DATABASE_POOL_MAX: "zero" })
    ).toThrow("Expected a positive integer");
  });
});
