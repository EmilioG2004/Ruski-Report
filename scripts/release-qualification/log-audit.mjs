/**
 * Audits structured application logs without printing their contents. It
 * reports only line numbers and rule names, preventing the audit from becoming
 * a second path for leaking credentials or private community content.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const forbiddenKeys = new Set([
  "authorization",
  "cookie",
  "password",
  "passwordhash",
  "reportcontext",
  "resolutionnote",
  "sessiontoken",
  "token",
  "xadmintoken"
]);

const forbiddenValuePatterns = [
  ["bearer credential", /\bbearer\s+[a-z0-9._~+/-]+=*/iu],
  ["database credential", /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/iu],
  ["JWT-like credential", /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/u]
];

export function auditLogText(text) {
  const violations = [];
  let structuredLineCount = 0;
  const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    for (const [rule, pattern] of forbiddenValuePatterns) {
      if (pattern.test(line)) addViolation(violations, lineNumber, rule);
    }

    try {
      const entry = JSON.parse(line);
      structuredLineCount += 1;
      inspectKeys(entry, lineNumber, violations);
      if (!isUsefulLogEntry(entry)) {
        addViolation(violations, lineNumber, "incomplete structured log");
      }
    } catch {}
  });

  if (lines.length === 0) {
    violations.push({ lineNumber: 0, rule: "empty log sample" });
  } else if (structuredLineCount === 0) {
    violations.push({ lineNumber: 0, rule: "no structured application entries" });
  }
  return { lineCount: lines.length, structuredLineCount, violations };
}

function inspectKeys(value, lineNumber, violations) {
  if (Array.isArray(value)) {
    value.forEach((item) => inspectKeys(item, lineNumber, violations));
    return;
  }
  if (value === null || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[_-]/gu, "").toLowerCase();
    if (forbiddenKeys.has(normalizedKey)) {
      addViolation(violations, lineNumber, `forbidden key '${key}'`);
    }
    inspectKeys(child, lineNumber, violations);
  }
}

function isUsefulLogEntry(entry) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    typeof entry.level === "string" &&
    typeof entry.message === "string" &&
    typeof entry.timestamp === "string"
  );
}

function addViolation(violations, lineNumber, rule) {
  if (!violations.some((item) => item.lineNumber === lineNumber && item.rule === rule)) {
    violations.push({ lineNumber, rule });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const filePath = process.argv[2];
  if (filePath === undefined) {
    console.error("Usage: node log-audit.mjs /path/to/application.log");
    process.exit(2);
  }

  const result = auditLogText(readFileSync(filePath, "utf8"));
  if (result.violations.length > 0) {
    console.error("Log audit failed:");
    for (const violation of result.violations) {
      console.error(`line ${violation.lineNumber}: ${violation.rule}`);
    }
    process.exit(1);
  }
  console.log(`Log audit passed for ${result.structuredLineCount} entries.`);
}
