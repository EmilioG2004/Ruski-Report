import assert from "node:assert/strict";
import test from "node:test";

import { assertRestoredDatabaseTarget } from "./restored-database-guard.mjs";

const target = {
  expectedHost: "phase7-db-a1b2c3d4",
  expectedDatabase: "phase7-data-a1b2c3d4",
  expectedUser: "phase7-user-a1b2c3d4",
  acknowledgement: "DISPOSABLE_RESTORED_COPY_ONLY"
};

test("accepts only the exact generated isolated target", () => {
  assert.deepEqual(assertRestoredDatabaseTarget({
    ...target,
    databaseUrl:
      "postgresql://phase7-user-a1b2c3d4:" +
      "0123456789abcdef0123456789abcdef@phase7-db-a1b2c3d4:5432/" +
      "phase7-data-a1b2c3d4"
  }), {
    host: target.expectedHost,
    database: target.expectedDatabase,
    user: target.expectedUser,
    port: 5432
  });
});

for (const [label, override] of [
  ["missing acknowledgement", { acknowledgement: undefined }],
  ["production host", { expectedHost: "postgres" }],
  ["loopback host", { expectedHost: "localhost" }],
  ["wrong host in URL", {}],
  ["query override", {}],
  ["weak password", {}]
]) {
  test(`rejects ${label}`, () => {
    const values = { ...target, ...override };
    const password = label === "weak password"
      ? "short"
      : "0123456789abcdef0123456789abcdef";
    const host = label === "wrong host in URL"
      ? "phase7-db-ffffffff"
      : values.expectedHost;
    const search = label === "query override" ? "?host=postgres" : "";
    assert.throws(() => assertRestoredDatabaseTarget({
      ...values,
      databaseUrl: `postgresql://${values.expectedUser}:${password}@${host}:5432/${values.expectedDatabase}${search}`
    }));
  });
}
