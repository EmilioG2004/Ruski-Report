/** Covers environment overrides and URL normalization for qualification. */

import assert from "node:assert/strict";
import test from "node:test";

import { loadQualificationConfiguration } from "./configuration.mjs";

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
