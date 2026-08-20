import { inflateRawSync } from "node:zlib";

import { CANONICAL_WORKBOOK_LIMITS } from "../schema";
import { CanonicalWorkbookSafetyError } from "./errors";
import {
  CanonicalXlsxEntry,
  CanonicalXlsxPreflightResult,
  WorkbookIssue
} from "./types";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MINIMUM_BYTES = 22;
const MAXIMUM_ZIP_COMMENT_BYTES = 65_535;

interface CentralEntry extends CanonicalXlsxEntry {
  readonly flags: number;
  readonly localHeaderOffset: number;
}

export function preflightCanonicalXlsx(
  buffer: Buffer
): CanonicalXlsxPreflightResult {
  if (buffer.byteLength > CANONICAL_WORKBOOK_LIMITS.maximumCompressedBytes) {
    fail("XLSX_COMPRESSED_SIZE_LIMIT", "Workbook exceeds the compressed size limit.");
  }
  const directoryOffset = findEndOfCentralDirectory(buffer);
  const disk = buffer.readUInt16LE(directoryOffset + 4);
  const centralDisk = buffer.readUInt16LE(directoryOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(directoryOffset + 8);
  const entryCount = buffer.readUInt16LE(directoryOffset + 10);
  const directorySize = buffer.readUInt32LE(directoryOffset + 12);
  const centralOffset = buffer.readUInt32LE(directoryOffset + 16);

  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    fail("XLSX_MULTIDISK_ARCHIVE", "Multi-disk workbook archives are not supported.");
  }
  if (entryCount === 0xffff || directorySize === 0xffffffff || centralOffset === 0xffffffff) {
    fail("XLSX_ZIP64_UNSUPPORTED", "ZIP64 workbook archives are not supported.");
  }
  if (entryCount > CANONICAL_WORKBOOK_LIMITS.maximumEntryCount) {
    fail("XLSX_ENTRY_COUNT_LIMIT", "Workbook contains too many archive entries.");
  }
  if (centralOffset + directorySize > directoryOffset) {
    fail("XLSX_INVALID_DIRECTORY", "Workbook central directory is malformed.");
  }

  const entries = readCentralEntries(buffer, centralOffset, directorySize, entryCount);
  let uncompressedBytes = 0;
  const names = new Set<string>();
  for (const entry of entries) {
    validateEntryPath(entry.name, names);
    validateEntrySize(entry);
    validateArchiveFeature(entry);
    validateLocalEntryHeader(buffer, entry);
    uncompressedBytes += entry.uncompressedBytes;
    if (uncompressedBytes > CANONICAL_WORKBOOK_LIMITS.maximumUncompressedBytes) {
      fail("XLSX_UNCOMPRESSED_SIZE_LIMIT", "Workbook expands beyond the safe size limit.");
    }
  }

  validatePackageParts(buffer, entries);
  return {
    compressedBytes: buffer.byteLength,
    uncompressedBytes,
    entries: entries.map(({ flags: _flags, localHeaderOffset: _offset, ...entry }) => entry)
  };
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const firstOffset = Math.max(
    0,
    buffer.byteLength - EOCD_MINIMUM_BYTES - MAXIMUM_ZIP_COMMENT_BYTES
  );
  for (let offset = buffer.byteLength - EOCD_MINIMUM_BYTES; offset >= firstOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) {
      continue;
    }
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + EOCD_MINIMUM_BYTES + commentLength === buffer.byteLength) {
      return offset;
    }
  }
  fail("XLSX_INVALID_ARCHIVE", "Workbook is not a valid XLSX ZIP archive.");
}

function readCentralEntries(
  buffer: Buffer,
  directoryOffset: number,
  directorySize: number,
  entryCount: number
): CentralEntry[] {
  const entries: CentralEntry[] = [];
  const directoryEnd = directoryOffset + directorySize;
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > directoryEnd || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      fail("XLSX_INVALID_DIRECTORY", "Workbook central directory entry is malformed.");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedBytes = buffer.readUInt32LE(offset + 20);
    const uncompressedBytes = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > directoryEnd) {
      fail("XLSX_INVALID_DIRECTORY", "Workbook central directory entry exceeds its bounds.");
    }
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.push({
      name,
      flags,
      compressionMethod,
      compressedBytes,
      uncompressedBytes,
      localHeaderOffset
    });
    offset = nextOffset;
  }
  if (offset !== directoryEnd) {
    fail("XLSX_INVALID_DIRECTORY", "Workbook central directory has unexpected trailing data.");
  }
  return entries;
}

function validateEntryPath(entryName: string, names: Set<string>): void {
  if (entryName.includes("\0")) {
    fail("XLSX_UNSAFE_ENTRY_PATH", "Workbook contains an invalid archive path.");
  }
  const normalized = entryName.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    segments.includes("..")
  ) {
    fail("XLSX_UNSAFE_ENTRY_PATH", "Workbook contains an unsafe archive path.");
  }
  const comparisonName = normalized.toLowerCase();
  if (names.has(comparisonName)) {
    fail("XLSX_DUPLICATE_ENTRY", "Workbook contains duplicate archive paths.");
  }
  names.add(comparisonName);
}

function validateEntrySize(entry: CentralEntry): void {
  if (entry.uncompressedBytes > CANONICAL_WORKBOOK_LIMITS.maximumEntryBytes) {
    fail("XLSX_ENTRY_SIZE_LIMIT", "Workbook archive entry exceeds the safe size limit.");
  }
  if (entry.uncompressedBytes > 0 && entry.compressedBytes === 0) {
    fail("XLSX_INVALID_COMPRESSION", "Workbook archive entry has an invalid compressed size.");
  }
  if (
    entry.compressedBytes > 0 &&
    entry.uncompressedBytes / entry.compressedBytes >
      CANONICAL_WORKBOOK_LIMITS.maximumCompressionRatio
  ) {
    fail("XLSX_COMPRESSION_RATIO_LIMIT", "Workbook archive entry exceeds the safe compression ratio.");
  }
}

function validateArchiveFeature(entry: CentralEntry): void {
  if ((entry.flags & 0x0001) !== 0) {
    fail("XLSX_ENCRYPTED_ARCHIVE", "Encrypted workbook archives are not supported.");
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    fail("XLSX_UNSUPPORTED_COMPRESSION", "Workbook uses an unsupported compression method.");
  }
  const name = entry.name.replaceAll("\\", "/").toLowerCase();
  if (
    name === "encryptioninfo" ||
    name === "encryptedpackage" ||
    name.endsWith("/vbaproject.bin") ||
    name.includes("/embeddings/") ||
    name.includes("/activex/") ||
    name.startsWith("customui/") ||
    name.includes("/oleobject") ||
    name.startsWith("xl/externallinks/") ||
    name === "xl/connections.xml"
  ) {
    fail("XLSX_ACTIVE_CONTENT", "Workbook contains macro, OLE, or external-link content.");
  }
}

function validatePackageParts(buffer: Buffer, entries: readonly CentralEntry[]): void {
  for (const entry of entries) {
    const lowerName = entry.name.toLowerCase();
    if (!lowerName.endsWith(".rels") && lowerName !== "[content_types].xml") {
      continue;
    }
    const text = readEntry(buffer, entry).toString("utf8");
    if (
      lowerName.endsWith(".rels") &&
      /<Relationship\b[^>]*\bTargetMode\s*=\s*["']External["']/i.test(text)
    ) {
      fail("XLSX_EXTERNAL_RELATIONSHIP", "Workbook contains an external package relationship.");
    }
    if (
      lowerName === "[content_types].xml" &&
      /macroEnabled|vbaProject|oleObject|activeX/i.test(text)
    ) {
      fail("XLSX_ACTIVE_CONTENT", "Workbook declares macro or embedded-object content.");
    }
  }
}

function readEntry(buffer: Buffer, entry: CentralEntry): Buffer {
  const data = validateLocalEntryHeader(buffer, entry);
  let expanded: Buffer;
  if (entry.compressionMethod === 0) {
    expanded = Buffer.from(data);
  } else {
    try {
      expanded = inflateRawSync(data, {
        maxOutputLength: CANONICAL_WORKBOOK_LIMITS.maximumEntryBytes
      });
    } catch {
      fail("XLSX_INVALID_COMPRESSION", "Workbook archive entry could not be safely expanded.");
    }
  }
  if (expanded.byteLength !== entry.uncompressedBytes) {
    fail("XLSX_INVALID_COMPRESSION", "Workbook archive entry size does not match its directory record.");
  }
  return expanded;
}

function validateLocalEntryHeader(buffer: Buffer, entry: CentralEntry): Buffer {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > buffer.byteLength || buffer.readUInt32LE(offset) !== LOCAL_SIGNATURE) {
    fail("XLSX_INVALID_LOCAL_ENTRY", "Workbook local archive entry is malformed.");
  }
  const flags = buffer.readUInt16LE(offset + 6);
  const method = buffer.readUInt16LE(offset + 8);
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
  if (flags !== entry.flags || method !== entry.compressionMethod || name !== entry.name) {
    fail("XLSX_LOCAL_DIRECTORY_MISMATCH", "Workbook local and central archive records disagree.");
  }
  const dataOffset = offset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedBytes;
  if (dataEnd > buffer.byteLength) {
    fail("XLSX_INVALID_LOCAL_ENTRY", "Workbook archive entry exceeds its bounds.");
  }
  const data = buffer.subarray(dataOffset, dataEnd);
  return data;
}

function fail(code: string, message: string): never {
  const issue: WorkbookIssue = { code, severity: "error", message };
  throw new CanonicalWorkbookSafetyError(message, issue);
}
