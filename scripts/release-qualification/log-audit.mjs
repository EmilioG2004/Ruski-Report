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
  "csrftoken",
  "preauthcsrf",
  "password",
  "passwordhash",
  "rawcsrftoken",
  "rawsessiontoken",
  "reportcontext",
  "resolutionnote",
  "secret",
  "sessiontoken",
  "token",
  "xadmintoken",
  "requestbody",
  "commentbody",
  "workbookbuffer",
  "workbookbytes",
  "workbookcontent",
  "workbookartifact"
]);

const forbiddenValuePatterns = [
  ["bearer credential", /\bbearer\s+[a-z0-9._~+/-]+=*/iu],
  ["database credential", /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/iu],
  ["JWT-like credential", /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/u],
  ["private key material", /-----BEGIN [A-Z ]*PRIVATE KEY-----/u],
  [
    "private filesystem path",
    /(?:^|[\s"'=])\/(?:Users|home|private|tmp|var)\//u
  ],
  [
    "unstructured sensitive assignment",
    /\b(?:authorization|cookie|csrf(?:[_-]?token)?|password(?:[_-]?hash)?|secret|session[_-]?token|x[_-]?admin[_-]?token)\s*[:=]\s*[^\s,;]+/iu
  ]
];

export function auditLogText(text, options = {}) {
  const canaries = validateCanaries(options.canaries ?? []);
  const violations = [];
  let structuredLineCount = 0;
  const allLines = text.split(/\r?\n/u);
  const lines = allLines
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0);

  lines.forEach(({ line, lineNumber }) => {
    for (const [rule, pattern] of forbiddenValuePatterns) {
      if (pattern.test(line)) addViolation(violations, lineNumber, rule);
    }
    if (canaries.some((canary) => line.includes(canary))) {
      addViolation(violations, lineNumber, "privacy canary matched");
    }

    const entry = parseStructuredEntry(line);
    if (entry === undefined && QUOTED_SENSITIVE_KEY_PATTERN.test(line)) {
      addViolation(violations, lineNumber, "quoted sensitive key");
    }
    if (entry !== undefined) {
      structuredLineCount += 1;
      inspectKeys(entry, lineNumber, violations);
      if (!isUsefulLogEntry(entry)) {
        addViolation(violations, lineNumber, "incomplete structured log");
      }
    }
  });

  if (lines.length === 0) {
    violations.push({ lineNumber: 0, rule: "empty log sample" });
  } else if (structuredLineCount === 0) {
    violations.push({ lineNumber: 0, rule: "no structured application entries" });
  }
  return { lineCount: lines.length, structuredLineCount, violations };
}

const QUOTED_SENSITIVE_KEY_PATTERN =
  /["'](?:authorization|cookie|csrf(?:[_-]?token)?|password(?:[_-]?hash)?|secret|session[_-]?token|x[_-]?admin[_-]?token)["']\s*:/iu;

function parseStructuredEntry(line) {
  try {
    return JSON.parse(line);
  } catch {}

  const candidateOffsets = [...line.matchAll(/[\[{]/gu)]
    .map((match) => match.index)
    .filter((index) => index !== undefined);
  for (const offset of candidateOffsets) {
    try {
      return JSON.parse(line.slice(offset));
    } catch {}
  }
  return undefined;
}

export function parseCanaryFile(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("Canary JSON must be an array.");
    }
    return validateCanaries(parsed);
  }
  return validateCanaries(
    trimmed.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  );
}

function validateCanaries(canaries) {
  if (!Array.isArray(canaries)) {
    throw new Error("Privacy canaries must be an array.");
  }
  const validated = canaries.map((canary) => {
    if (typeof canary !== "string" || canary.length < 8) {
      throw new Error("Privacy canaries must contain at least eight characters.");
    }
    return canary;
  });
  if (new Set(validated).size !== validated.length) {
    throw new Error("Privacy canaries must be unique.");
  }
  return validated;
}

function inspectKeys(value, lineNumber, violations, parentKey = undefined) {
  if (Array.isArray(value)) {
    value.forEach((item) => inspectKeys(item, lineNumber, violations, parentKey));
    return;
  }
  if (value === null || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[_-]/gu, "").toLowerCase();
    if (forbiddenKeys.has(normalizedKey)) {
      addViolation(violations, lineNumber, `forbidden key '${key}'`);
    }
    if (normalizedKey === "stack") {
      addViolation(violations, lineNumber, "raw exception stack");
    }
    if (parentKey === "error" && normalizedKey !== "name") {
      addViolation(violations, lineNumber, "raw exception detail");
    }
    inspectKeys(child, lineNumber, violations, normalizedKey);
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
  const canaryPath = process.argv[3];
  if (filePath === undefined || canaryPath === undefined) {
    console.error(
      "Usage: node log-audit.mjs /path/to/application.log /path/to/canaries"
    );
    process.exit(2);
  }

  let result;
  try {
    const canaries = parseCanaryFile(readFileSync(canaryPath, "utf8"));
    if (canaries.length === 0) {
      throw new Error("At least one privacy canary is required.");
    }
    result = auditLogText(readFileSync(filePath, "utf8"), { canaries });
  } catch {
    console.error("Log audit input could not be read or validated.");
    process.exit(2);
  }
  if (result.violations.length > 0) {
    console.error("Log audit failed:");
    for (const violation of result.violations) {
      console.error(`line ${violation.lineNumber}: ${violation.rule}`);
    }
    process.exit(1);
  }
  console.log(`Log audit passed for ${result.structuredLineCount} entries.`);
}
