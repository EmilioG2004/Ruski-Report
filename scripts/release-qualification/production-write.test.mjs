/** Proves production mutations remain unavailable without both safeguards. */

import assert from "node:assert/strict";
import test from "node:test";

import { runProductionWriteQualification } from "./production-write.mjs";

test("rejects production writes without explicit opt-in", async () => {
  await assert.rejects(
    runProductionWriteQualification({}),
    /RUSKI_QUALIFICATION_ALLOW_WRITES=YES/u
  );
});

test("rejects production writes without an admin token", async () => {
  await assert.rejects(
    runProductionWriteQualification({
      RUSKI_QUALIFICATION_ALLOW_WRITES: "YES"
    }),
    /RUSKI_QUALIFICATION_ADMIN_TOKEN is required/u
  );
});
