/** Covers environment overrides and URL normalization for qualification. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  loadExpectedActiveTournamentIds,
  loadExpectedTournamentStatisticCorrections,
  loadQualificationConfiguration
} from "./configuration.mjs";

test("normalizes the API base URL for relative endpoint resolution", () => {
  const configuration = loadQualificationConfiguration({
    RUSKI_QUALIFICATION_API_URL: "https://example.com/api",
    RUSKI_QUALIFICATION_PUBLIC_URL: "https://example.com",
    RUSKI_QUALIFICATION_TIMEOUT_MS: "2000",
    RUSKI_QUALIFICATION_YEAR: "2026"
  });

  assert.equal(configuration.apiBaseUrl.href, "https://example.com/api/");
  assert.equal(configuration.requestTimeoutMilliseconds, 2000);
});

test("rejects a non-HTTPS production endpoint", () => {
  assert.throws(
    () =>
      loadQualificationConfiguration({
        RUSKI_QUALIFICATION_API_URL: "http://example.com/api"
      }),
    /must use HTTPS/u
  );
});

test("requires an explicit expected active tournament set", () => {
  assert.deepEqual(loadExpectedActiveTournamentIds({
    RUSKI_QUALIFICATION_EXPECTED_ACTIVE_TOURNAMENT_IDS: "none"
  }), []);
  assert.deepEqual(loadExpectedActiveTournamentIds({
    RUSKI_QUALIFICATION_EXPECTED_ACTIVE_TOURNAMENT_IDS:
      "summer-2027, fall-2027"
  }), ["fall-2027", "summer-2027"]);
  assert.throws(
    () => loadExpectedActiveTournamentIds({}),
    /must be 'none' or an explicit comma-separated list/u
  );
  assert.throws(
    () => loadExpectedActiveTournamentIds({
      RUSKI_QUALIFICATION_EXPECTED_ACTIVE_TOURNAMENT_IDS:
        "summer-2027,summer-2027"
    }),
    /is invalid/u
  );
});

test("validates optional backfill statistic-correction evidence", () => {
  assert.equal(loadExpectedTournamentStatisticCorrections({}), undefined);
  assert.deepEqual(loadExpectedTournamentStatisticCorrections({
    RUSKI_QUALIFICATION_STATISTIC_CORRECTION_COUNT: "55",
    RUSKI_QUALIFICATION_STATISTIC_CORRECTION_DIGEST: "a".repeat(64)
  }), {
    policy: "canonical_match_events_v1",
    mismatchCount: 55,
    mismatchDigest: "a".repeat(64)
  });
  assert.throws(
    () => loadExpectedTournamentStatisticCorrections({
      RUSKI_QUALIFICATION_STATISTIC_CORRECTION_COUNT: "55"
    }),
    /must be supplied together/u
  );
});
