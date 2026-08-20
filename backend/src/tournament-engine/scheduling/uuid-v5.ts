import { createHash } from "node:crypto";

const UUID_BYTES = 16;

export function createUuidV5(namespace: string, name: string): string {
  const namespaceBytes = uuidToBytes(namespace);
  const digest = createHash("sha1")
    .update(namespaceBytes)
    .update(name, "utf8")
    .digest();
  const bytes = Uint8Array.from(digest.subarray(0, UUID_BYTES));

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytesToUuid(bytes);
}

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replaceAll("-", "");

  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    throw new Error(`Invalid UUID namespace '${uuid}'.`);
  }

  return Buffer.from(hex, "hex");
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join("-");
}
