import { createHash } from "node:crypto";

export function serializeCanonicalPublicJson(value: unknown): string {
  return JSON.stringify(sortPublicJson(value));
}

export function digestCanonicalPublicJson(value: unknown): string {
  return createHash("sha256")
    .update(serializeCanonicalPublicJson(value))
    .digest("hex");
}

function sortPublicJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortPublicJson);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortPublicJson(child)])
  );
}
