/** Covers privacy failures without requiring or emitting real sensitive data. */

import assert from "node:assert/strict";
import test from "node:test";

import { auditLogText, parseCanaryFile } from "./log-audit.mjs";

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

test("inspects JSON embedded after a framework prefix", () => {
  const entry = JSON.stringify({
    level: "warn",
    message: "Request rejected.",
    timestamp: "2026-08-17T12:00:00.000Z",
    metadata: { password: "synthetic-private-value" }
  });
  const result = auditLogText(`framework-prefix ${entry}`);

  assert.deepEqual(result.violations, [
    { lineNumber: 1, rule: "forbidden key 'password'" }
  ]);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private-value/u);
});

test("rejects quoted sensitive keys even with trailing framework text", () => {
  const structured = JSON.stringify({
    level: "info",
    message: "Operation completed.",
    timestamp: "2026-08-17T12:00:00.000Z"
  });
  const result = auditLogText(
    `framework {"password":"synthetic-private-value"} trailing\n${structured}`
  );

  assert.deepEqual(result.violations, [
    { lineNumber: 1, rule: "quoted sensitive key" }
  ]);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private-value/u);
});

test("finds a privacy canary in structured content without retaining it", () => {
  const canary = "QUALIFICATION-CANARY-1234";
  const entry = JSON.stringify({
    level: "info",
    message: "Operation completed.",
    timestamp: "2026-08-17T12:00:00.000Z",
    metadata: { detail: canary }
  });
  const result = auditLogText(entry, { canaries: [canary] });

  assert.deepEqual(result.violations, [
    { lineNumber: 1, rule: "privacy canary matched" }
  ]);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(canary, "u"));
});

test("finds canaries and sensitive assignments in unstructured lines", () => {
  const canary = "QUALIFICATION-CANARY-5678";
  const structured = JSON.stringify({
    level: "info",
    message: "Operation completed.",
    timestamp: "2026-08-17T12:00:00.000Z"
  });
  const result = auditLogText(
    `framework detail ${canary}\nCookie=synthetic-cookie\n${structured}`,
    { canaries: [canary] }
  );

  assert.deepEqual(result.violations, [
    { lineNumber: 1, rule: "privacy canary matched" },
    { lineNumber: 2, rule: "unstructured sensitive assignment" }
  ]);
});

test("rejects private request, workbook, and CSRF fields recursively", () => {
  const entry = JSON.stringify({
    level: "warn",
    message: "Request rejected.",
    timestamp: "2026-08-17T12:00:00.000Z",
    metadata: {
      requestBody: { workbookBytes: 123 },
      csrfToken: "synthetic"
    }
  });

  assert.deepEqual(auditLogText(entry).violations, [
    { lineNumber: 1, rule: "forbidden key 'requestBody'" },
    { lineNumber: 1, rule: "forbidden key 'workbookBytes'" },
    { lineNumber: 1, rule: "forbidden key 'csrfToken'" }
  ]);
});

test("rejects raw exception details and private filesystem paths", () => {
  const entry = JSON.stringify({
    level: "error",
    message: "Request failed.",
    timestamp: "2026-08-17T12:00:00.000Z",
    error: {
      name: "Error",
      message: "synthetic-private-detail",
      stack: "Error at /Users/example/private-source.ts"
    }
  });
  const result = auditLogText(entry);

  assert.deepEqual(result.violations, [
    { lineNumber: 1, rule: "private filesystem path" },
    { lineNumber: 1, rule: "raw exception detail" },
    { lineNumber: 1, rule: "raw exception stack" }
  ]);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private-detail|Users/u);
});

test("parses JSON and line-delimited canary files", () => {
  assert.deepEqual(parseCanaryFile('["CANARY-ONE", "CANARY-TWO"]'), [
    "CANARY-ONE", "CANARY-TWO"
  ]);
  assert.deepEqual(parseCanaryFile("CANARY-THREE\nCANARY-FOUR\n"), [
    "CANARY-THREE", "CANARY-FOUR"
  ]);
});
