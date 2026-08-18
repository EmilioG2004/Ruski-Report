/** Covers privacy failures without requiring or emitting real sensitive data. */

import assert from "node:assert/strict";
import test from "node:test";

import { auditLogText } from "./log-audit.mjs";

test("accepts useful structured metadata", () => {
  const entry = JSON.stringify({
    level: "info",
    message: "Operation completed.",
    timestamp: "2026-08-17T12:00:00.000Z",
    metadata: { decision: "allowed", bodyCharacterCount: 12 }
  });
  assert.deepEqual(auditLogText(entry).violations, []);
});

test("reports forbidden fields by rule without retaining values", () => {
  const entry = JSON.stringify({
    level: "info",
    message: "Operation completed.",
    timestamp: "2026-08-17T12:00:00.000Z",
    sessionToken: "synthetic-secret"
  });
  const result = auditLogText(entry);

  assert.deepEqual(result.violations, [
    { lineNumber: 1, rule: "forbidden key 'sessionToken'" }
  ]);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret/u);
});

test("allows framework lines when structured application entries exist", () => {
  const structured = JSON.stringify({
    level: "info",
    message: "Operation completed.",
    timestamp: "2026-08-17T12:00:00.000Z"
  });
  const result = auditLogText(`Framework startup line\n${structured}`);

  assert.deepEqual(result.violations, []);
  assert.equal(result.structuredLineCount, 1);
});
