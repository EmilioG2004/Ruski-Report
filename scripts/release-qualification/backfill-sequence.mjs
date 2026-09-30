#!/usr/bin/env node

/** Verifies the safe summaries from the Phase 7 dry-run/apply/no-op sequence. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function verifyBackfillSequence([firstDryRun, secondDryRun, applied, noOp]) {
  requireStatus(firstDryRun, "dry_run", true, "first dry run");
  requireStatus(secondDryRun, "dry_run", true, "second dry run");
  requireStatus(applied, "applied", false, "apply");
  requireStatus(noOp, "no_op", false, "second apply");

  const planned = planEvidence(firstDryRun);
  for (const [label, result] of [
    ["second dry run", secondDryRun],
    ["apply", applied],
    ["second apply", noOp]
  ]) {
    if (stableJson(planEvidence(result)) !== stableJson(planned)) {
      throw new Error(`Backfill ${label} does not match the first dry-run plan.`);
    }
  }
  const appliedCheckpoint = checkpointEvidence(applied, "apply");
  const noOpCheckpoint = checkpointEvidence(noOp, "second apply");
  if (stableJson(appliedCheckpoint) !== stableJson(noOpCheckpoint)) {
    throw new Error("Backfill checkpoint evidence changed on the no-op apply.");
  }

  return {
    schemaVersion: 1,
    status: "passed",
    legacyTournamentId: planned.legacyTournamentId,
    sourceSnapshotVersion: planned.sourceSnapshotVersion,
    sourceDigest: planned.sourceDigest,
    planDigest: planned.planDigest,
    mappingDigest: planned.mappingDigest,
    counts: planned.counts,
    issueCodes: planned.issueCodes,
    checkpointEvidence: appliedCheckpoint
  };
}

function planEvidence(result) {
  requireObject(result, "backfill result");
  requireString(result.legacyTournamentId, "legacy tournament id");
  requireInteger(result.sourceSnapshotVersion, "source snapshot version");
  requireDigest(result.sourceDigest, "source digest");
  requireDigest(result.planDigest, "plan digest");
  requireDigest(result.mappingDigest, "mapping digest");
  requireObject(result.counts, "backfill counts");
  if (!Array.isArray(result.issues)) {
    throw new Error("Backfill issues are missing.");
  }
  const issueCodes = result.issues.map((issue) => {
    requireObject(issue, "backfill issue");
    requireString(issue.code, "backfill issue code");
    return issue.code;
  });
  return {
    legacyTournamentId: result.legacyTournamentId,
    sourceSnapshotVersion: result.sourceSnapshotVersion,
    sourceDigest: result.sourceDigest,
    planDigest: result.planDigest,
    mappingDigest: result.mappingDigest,
    counts: result.counts,
    issueCodes
  };
}

function checkpointEvidence(result, label) {
  const checkpoint = result.checkpointEvidence;
  requireObject(checkpoint, `${label} checkpoint evidence`);
  requireDigest(checkpoint.protectedLegacyDigest, "protected legacy digest");
  const corrections = checkpoint.tournamentStatisticCorrections;
  requireObject(corrections, "tournament statistic corrections");
  if (corrections.policy !== "canonical_match_events_v1") {
    throw new Error("Tournament statistic correction policy is invalid.");
  }
  requireInteger(corrections.mismatchCount, "statistic correction count", true);
  requireDigest(corrections.mismatchDigest, "statistic correction digest");
  return checkpoint;
}

function requireStatus(result, expectedStatus, expectedDryRun, label) {
  requireObject(result, label);
  if (
    result.status !== expectedStatus ||
    result.dryRun !== expectedDryRun ||
    result.retryable !== false
  ) {
    throw new Error(`Backfill ${label} has an invalid outcome.`);
  }
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is invalid.`);
  }
}

function requireDigest(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function requireInteger(value, label, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${label} is invalid.`);
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 6) {
    console.error(
      "Usage: backfill-sequence.mjs FIRST_DRY_RUN SECOND_DRY_RUN APPLY SECOND_APPLY"
    );
    process.exit(2);
  }
  try {
    const results = process.argv.slice(2).map((path) =>
      JSON.parse(readFileSync(path, "utf8"))
    );
    console.log(JSON.stringify(verifyBackfillSequence(results), null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Backfill sequence verification failed: ${message}`);
    process.exitCode = 1;
  }
}
