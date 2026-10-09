import assert from "node:assert/strict";
import test from "node:test";

import { verifyBackfillSequence } from "./backfill-sequence.mjs";

test("accepts two deterministic dry runs, one apply, and one no-op", () => {
  const result = verifyBackfillSequence([
    backfill("dry_run", true),
    backfill("dry_run", true),
    backfill("applied", false, true),
    backfill("no_op", false, true)
  ]);
  assert.equal(result.status, "passed");
  assert.equal(result.checkpointEvidence.protectedLegacyDigest, "d".repeat(64));
});

test("rejects a plan change between runs", () => {
  const changed = backfill("dry_run", true);
  changed.counts.teams = 5;
  assert.throws(() => verifyBackfillSequence([
    backfill("dry_run", true),
    changed,
    backfill("applied", false, true),
    backfill("no_op", false, true)
  ]), /does not match the first dry-run plan/u);
});

test("rejects a changed protected-row checkpoint on the no-op apply", () => {
  const changed = backfill("no_op", false, true);
  changed.checkpointEvidence.protectedLegacyDigest = "e".repeat(64);
  assert.throws(() => verifyBackfillSequence([
    backfill("dry_run", true),
    backfill("dry_run", true),
    backfill("applied", false, true),
    changed
  ]), /checkpoint evidence changed/u);
});

function backfill(status, dryRun, checkpoint = false) {
  return {
    runId: "ignored",
    legacyTournamentId: "tournament-2026",
    sourceSnapshotVersion: 3,
    sourceDigest: "a".repeat(64),
    planDigest: "b".repeat(64),
    mappingDigest: "c".repeat(64),
    status,
    dryRun,
    retryable: false,
    counts: { teams: 4, matches: 6 },
    ...(checkpoint ? {
      checkpointEvidence: {
        protectedLegacyDigest: "d".repeat(64),
        tournamentStatisticCorrections: {
          policy: "canonical_match_events_v1",
          mismatchCount: 1,
          mismatchDigest: "f".repeat(64)
        }
      }
    } : {}),
    issues: []
  };
}
