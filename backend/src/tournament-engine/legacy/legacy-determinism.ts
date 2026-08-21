import { createHash } from "node:crypto";

import { LegacyEntityKind } from "./legacy-backfill.types";

const LEGACY_BACKFILL_NAMESPACE = "b17d3d71-ff0f-5ed2-84b4-e42af968389c";

export interface DeterministicLegacyIdentity {
  id: string;
  publicKey: string;
  legacyKey: string;
}

export function createLegacyIdentity(
  entityKind: LegacyEntityKind,
  legacyTournamentId: string,
  sourceParts: readonly (string | number)[],
  existingPublicKey?: string
): DeterministicLegacyIdentity {
  const legacyKey = stableStringify([
    "ruski-report-legacy-backfill",
    1,
    entityKind,
    legacyTournamentId,
    ...sourceParts
  ]);
  const id = createUuidV5(LEGACY_BACKFILL_NAMESPACE, legacyKey);

  return {
    id,
    legacyKey,
    publicKey:
      existingPublicKey ?? `legacy_${entityKind}_${id.replaceAll("-", "")}`
  };
}

export function createDigest(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value));
}

function normalizeJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Cannot create a digest from a non-finite number.");
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item));
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .filter((entry) => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((result, [key, item]) => {
        result[key] = normalizeJsonValue(item);
        return result;
      }, {});
  }

  throw new Error(`Cannot create a digest from value type '${typeof value}'.`);
}

function createUuidV5(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll("-", ""), "hex");
  if (namespaceBytes.length !== 16) {
    throw new Error("Legacy backfill UUID namespace is invalid.");
  }

  const digest = createHash("sha1")
    .update(namespaceBytes)
    .update(name, "utf8")
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
}
