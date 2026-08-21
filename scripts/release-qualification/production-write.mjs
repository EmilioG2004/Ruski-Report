/**
 * The legacy production-write workflow republished the 2026 workbook. That is
 * not a valid canonical-engine qualification action and is retired fail-closed.
 */

import { fileURLToPath } from "node:url";

export async function runProductionWriteQualification() {
  throw new Error(
    "PRODUCTION_WRITE_RETIRED: use the Phase 7 rollout runbook with explicit " +
      "authorization and recorded backup, migration, equivalence, and rollback evidence."
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runProductionWriteQualification();
  } catch {
    console.error("PRODUCTION_WRITE_RETIRED");
    process.exitCode = 2;
  }
}
