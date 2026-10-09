import assert from "node:assert/strict";
import test from "node:test";

import { requireDisposableDatabasePair } from "./database-guard.mjs";

test("requires both disposable database URLs", () => {
  assert.throws(
    () => requireDisposableDatabasePair({
      TEST_DATABASE_URL: "postgresql://localhost/qualification_clean"
    }),
    /POPULATED_MIGRATION_DATABASE_URL is required/u
  );
});

test("requires different databases", () => {
  const url = "postgresql://localhost/qualification_shared";
  assert.throws(
    () => requireDisposableDatabasePair({
      TEST_DATABASE_URL: url,
      POPULATED_MIGRATION_DATABASE_URL: url
    }),
    /different disposable databases/u
  );
  assert.throws(
    () => requireDisposableDatabasePair({
      TEST_DATABASE_URL: "postgresql://localhost/ruski_phase7_test",
      POPULATED_MIGRATION_DATABASE_URL:
        "postgresql://127.0.0.1/ruski_phase7_test"
    }),
    /different disposable databases/u
  );
});

test("accepts a clean and populated migration pair", () => {
  assert.deepEqual(requireDisposableDatabasePair({
    TEST_DATABASE_URL: "postgresql://localhost/qualification_clean",
    POPULATED_MIGRATION_DATABASE_URL:
      "postgresql://localhost/qualification_populated"
  }), {
    TEST_DATABASE_URL: "postgresql://localhost/qualification_clean",
    POPULATED_MIGRATION_DATABASE_URL:
      "postgresql://localhost/qualification_populated"
  });
});

test("rejects PostgreSQL system databases", () => {
  assert.throws(
    () => requireDisposableDatabasePair({
      TEST_DATABASE_URL: "postgresql://localhost/postgres",
      POPULATED_MIGRATION_DATABASE_URL:
        "postgresql://localhost/qualification_populated"
    }),
    /system database/u
  );
});

test("rejects a production-like database name", () => {
  assert.throws(
    () => requireDisposableDatabasePair({
      TEST_DATABASE_URL: "postgresql://localhost/ruski_report",
      POPULATED_MIGRATION_DATABASE_URL:
        "postgresql://localhost/qualification_populated"
    }),
    /explicitly identify disposable test data/u
  );
});

test("rejects a remote database even when its name looks disposable", () => {
  assert.throws(
    () => requireDisposableDatabasePair({
      TEST_DATABASE_URL: "postgresql://db.example.test/ruski_phase7_test",
      POPULATED_MIGRATION_DATABASE_URL:
        "postgresql://localhost/ruski_phase7_qualification"
    }),
    /must target a local disposable PostgreSQL server/u
  );
  assert.throws(
    () => requireDisposableDatabasePair({
      TEST_DATABASE_URL:
        "postgresql://localhost/ruski_phase7_test?host=db.example.test",
      POPULATED_MIGRATION_DATABASE_URL:
        "postgresql://localhost/ruski_phase7_qualification"
    }),
    /must target a local disposable PostgreSQL server/u
  );
});
