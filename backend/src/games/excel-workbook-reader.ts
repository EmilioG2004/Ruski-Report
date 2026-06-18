import { CellValue, Workbook, Worksheet } from "exceljs";

import { ParsedScorebookCellValue } from "./parsed-scorebook";
import { ScorebookFile } from "./scorebook-file";

export class ExcelWorkbookReader {
  private constructor(private readonly workbook: Workbook) {}

  static async load(file: ScorebookFile): Promise<ExcelWorkbookReader> {
    const workbook = new Workbook();
    const workbookBuffer = file.buffer.buffer.slice(
      file.buffer.byteOffset,
      file.buffer.byteOffset + file.buffer.byteLength
    ) as ArrayBuffer;

    await workbook.xlsx.load(workbookBuffer);

    return new ExcelWorkbookReader(workbook);
  }

  get worksheets(): ExcelWorksheetReader[] {
    return this.workbook.worksheets.map(
      (worksheet, index) => new ExcelWorksheetReader(worksheet, index)
    );
  }
}

export class ExcelWorksheetReader {
  constructor(
    private readonly worksheet: Worksheet,
    readonly index: number
  ) {}

  get name(): string {
    return this.worksheet.name;
  }

  readCell(address: string): ParsedScorebookCellValue {
    return normalizeCellValue(this.worksheet.getCell(address).value);
  }
}

function normalizeCellValue(value: CellValue): ParsedScorebookCellValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if ("result" in value) {
    return normalizeCellValue(value.result);
  }

  if ("formula" in value || "sharedFormula" in value || "error" in value) {
    return null;
  }

  if ("text" in value && typeof value.text === "string") {
    return normalizeCellValue(value.text);
  }

  if ("richText" in value && Array.isArray(value.richText)) {
    return normalizeCellValue(
      value.richText.map((entry) => entry.text).join("")
    );
  }

  return normalizeCellValue(String(value));
}
