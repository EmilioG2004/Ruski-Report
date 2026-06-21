import {
  ParsedScorebookCellValue,
  ParsedScorebookRow
} from "./parsed-scorebook";
import { ExcelWorksheetReader } from "./excel-workbook-reader";
import {
  formatCellAddress,
  parseCellAddress
} from "./scorebook-cell-address";
import {
  ScorebookCellRange,
  ScorebookHeaderCell
} from "./scorebook-schema";

export interface ScorebookTabularSheetSchema {
  headers: readonly ScorebookHeaderCell[];
  dataRange: ScorebookCellRange;
}

export class ScorebookTabularSheetParser {
  parse(
    worksheet: ExcelWorksheetReader,
    schema: ScorebookTabularSheetSchema
  ): ParsedScorebookRow[] {
    const start = parseCellAddress(schema.dataRange.start);
    const end = parseCellAddress(schema.dataRange.end);
    const headerColumns = schema.headers.map((header) => ({
      key: header.key,
      column: parseCellAddress(header.cell).column
    }));
    const rows: ParsedScorebookRow[] = [];

    for (let rowNumber = start.row; rowNumber <= end.row; rowNumber += 1) {
      const values: Record<string, ParsedScorebookCellValue> = {};
      const sourceCells: Record<string, string> = {};

      headerColumns.forEach((header) => {
        const sourceCell = formatCellAddress({
          column: header.column,
          row: rowNumber
        });
        values[header.key] = worksheet.readCell(sourceCell);
        sourceCells[header.key] = sourceCell;
      });

      if (hasRowData(values)) {
        rows.push({
          rowNumber,
          values,
          metadata: {
            sourceCells
          }
        });
      }
    }

    return rows;
  }
}

function hasRowData(values: Record<string, ParsedScorebookCellValue>): boolean {
  return Object.values(values).some((value) => value !== null);
}
