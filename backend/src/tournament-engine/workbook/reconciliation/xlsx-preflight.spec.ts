import { CanonicalWorkbookSafetyError } from "./errors";
import {
  createSanitizedWorkbookFixture,
  mutateWorkbook
} from "./fixtures/sanitized-workbook.fixture";
import { preflightCanonicalXlsx } from "./xlsx-preflight";

describe("canonical XLSX preflight", () => {
  it("accepts a generated package within bounded central-directory limits", async () => {
    const fixture = await createSanitizedWorkbookFixture();
    const result = preflightCanonicalXlsx(fixture.buffer);
    expect(result.entries.length).toBeGreaterThan(10);
    expect(result.uncompressedBytes).toBeGreaterThan(result.compressedBytes);
  });

  it("rejects encrypted entries before workbook inflation", async () => {
    const fixture = await createSanitizedWorkbookFixture();
    const encrypted = mutateFirstCentralEntry(fixture.buffer, (buffer, central, local) => {
      buffer.writeUInt16LE(buffer.readUInt16LE(central + 8) | 1, central + 8);
      buffer.writeUInt16LE(buffer.readUInt16LE(local + 6) | 1, local + 6);
    });
    expectSafetyCode(encrypted, "XLSX_ENCRYPTED_ARCHIVE");
  });

  it("rejects macro-like package parts before reading their payload", async () => {
    const fixture = await createSanitizedWorkbookFixture();
    const active = renameEntry(
      fixture.buffer,
      "docProps/core.xml",
      "xl/vbaProject.bin"
    );
    expectSafetyCode(active, "XLSX_ACTIVE_CONTENT");
  });

  it("rejects external relationships and suspicious compression ratios", async () => {
    const fixture = await createSanitizedWorkbookFixture();
    const linked = await mutateWorkbook(fixture.buffer, (workbook) => {
      const control = workbook.getWorksheet("Control");
      if (control === undefined) {
        throw new Error("Control sheet missing from sanitized fixture.");
      }
      control.getCell("A1").value = {
        text: "External",
        hyperlink: "https://example.invalid/private"
      };
    });
    expectSafetyCode(linked, "XLSX_EXTERNAL_RELATIONSHIP");

    const ratio = mutateFirstCentralEntry(fixture.buffer, (buffer, central) => {
      const compressed = buffer.readUInt32LE(central + 20);
      buffer.writeUInt32LE(Math.max(compressed * 201, 1), central + 24);
    });
    expectSafetyCode(ratio, "XLSX_COMPRESSION_RATIO_LIMIT");
  });
});

function expectSafetyCode(buffer: Buffer, code: string): void {
  try {
    preflightCanonicalXlsx(buffer);
    throw new Error("Expected workbook safety preflight to reject the package.");
  } catch (caught) {
    expect(caught).toBeInstanceOf(CanonicalWorkbookSafetyError);
    expect((caught as CanonicalWorkbookSafetyError).issue.code).toBe(code);
  }
}

function mutateFirstCentralEntry(
  source: Buffer,
  mutation: (buffer: Buffer, centralOffset: number, localOffset: number) => void
): Buffer {
  const buffer = Buffer.from(source);
  const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  if (central < 0) {
    throw new Error("Central directory was not found.");
  }
  const local = buffer.readUInt32LE(central + 42);
  mutation(buffer, central, local);
  return buffer;
}

function renameEntry(source: Buffer, previous: string, next: string): Buffer {
  if (Buffer.byteLength(previous) !== Buffer.byteLength(next)) {
    throw new Error("Test archive entry replacement must preserve path length.");
  }
  const buffer = Buffer.from(source);
  const previousBytes = Buffer.from(previous);
  const nextBytes = Buffer.from(next);
  let offset = buffer.indexOf(previousBytes);
  let replacements = 0;
  while (offset >= 0) {
    nextBytes.copy(buffer, offset);
    replacements += 1;
    offset = buffer.indexOf(previousBytes, offset + previousBytes.length);
  }
  if (replacements !== 2) {
    throw new Error("Expected one local and one central archive path.");
  }
  return buffer;
}
