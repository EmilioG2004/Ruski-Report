/** Proves the obsolete 2026 production-republish workflow stays unavailable. */

import assert from "node:assert/strict";
import test from "node:test";

import { runProductionWriteQualification } from "./production-write.mjs";

test("rejects the retired production-write workflow", async () => {
  await assert.rejects(
    runProductionWriteQualification({}),
    /PRODUCTION_WRITE_RETIRED/u
  );
});
