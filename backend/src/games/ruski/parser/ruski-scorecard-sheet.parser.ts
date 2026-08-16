import {
  ParsedScorebookCellValue,
  ParsedScorebookGameSheet,
  ParsedScorebookShotRow,
  ParsedScorebookSide,
  ParsedScorebookStatLine,
} from "../../parsed-scorebook";
import { ExcelWorksheetReader } from "../../excel-workbook-reader";
import { expandCellRangeRows } from "../../scorebook-cell-address";
import {
  ScorebookHeaderCell,
  ScorebookSideSchema
} from "../../scorebook-schema";
import { ruskiScorebookSchema } from "../scorebook";

export class RuskiScorecardSheetParser {
  parse(worksheet: ExcelWorksheetReader): ParsedScorebookGameSheet {
    return {
      status: toText(
        worksheet.readCell(ruskiScorebookSchema.blankScorecard.statusCell)
      ),
      sides: ruskiScorebookSchema.blankScorecard.sides.map((side) =>
        this.parseSide(worksheet, side)
      )
    };
  }

  private parseSide(
    worksheet: ExcelWorksheetReader,
    side: ScorebookSideSchema
  ): ParsedScorebookSide {
    const players = side.playerNameCells.flatMap((cell, index) => {
      const name = toText(worksheet.readCell(cell));

      if (name === null) {
        return [];
      }

      return [
        {
          slot: index + 1,
          name,
          sourceCell: cell
        }
      ];
    });

    return {
      id: side.id,
      label: side.label,
      players,
      boxScoreTotals: this.parseBoxScoreTotals(worksheet, side),
      shotRows: this.parseShotRows(worksheet, side)
    };
  }

  private parseBoxScoreTotals(
    worksheet: ExcelWorksheetReader,
    side: ScorebookSideSchema
  ): ParsedScorebookStatLine[] {
    return expandCellRangeRows(side.statSummaryValuesRange).map(
      (row, index): ParsedScorebookStatLine => {
        const stats: Record<string, number | null> = {};
        const sourceCells: Record<string, string> = {};

        side.statSummaryHeaders.forEach((header, headerIndex) => {
          const cell = row.cells[headerIndex];
          stats[header.key] = toCount(worksheet.readCell(cell));
          sourceCells[header.key] = cell;
        });

        const shootingPercentageCell = side.shootingPercentageCells?.[index];

        if (shootingPercentageCell !== undefined) {
          stats.shootingPercentage = toNumber(
            worksheet.readCell(shootingPercentageCell)
          );
          sourceCells.shootingPercentage = shootingPercentageCell;
        }

        const playerSlot = index + 1;

        return {
          playerSlot,
          playerName:
            toText(worksheet.readCell(side.playerNameCells[index])) ?? null,
          stats,
          sourceCells
        };
      }
    );
  }

  private parseShotRows(
    worksheet: ExcelWorksheetReader,
    side: ScorebookSideSchema
  ): ParsedScorebookShotRow[] {
    return expandCellRangeRows(side.shotRowsRange)
      .map((row) => this.parseShotRow(worksheet, side.shotHeaders, row))
      .filter(hasShotRowData);
  }

  private parseShotRow(
    worksheet: ExcelWorksheetReader,
    headers: readonly ScorebookHeaderCell[],
    row: {
      rowNumber: number;
      cells: string[];
    }
  ): ParsedScorebookShotRow {
    const sourceCells: Record<string, string> = {};
    const values: Record<string, ParsedScorebookCellValue> = {};

    headers.forEach((header, index) => {
      const cell = row.cells[index];
      sourceCells[header.key] = cell;
      values[header.key] = worksheet.readCell(cell);
    });

    const eventFlags = headers
      .filter(
        (header) => header.key !== "shotNumber" && header.key !== "shooter"
      )
      .reduce<Record<string, boolean>>((flags, header) => {
        flags[header.key] = toBooleanFlag(values[header.key]);
        return flags;
      }, {});

    return {
      rowNumber: row.rowNumber,
      shotNumber: toNumber(values.shotNumber),
      shooterName: toText(values.shooter),
      eventFlags,
      sourceCells
    };
  }
}

function hasShotRowData(row: ParsedScorebookShotRow): boolean {
  return (
    row.shotNumber !== null ||
    row.shooterName !== null ||
    Object.values(row.eventFlags).some(Boolean)
  );
}

function toText(value: ParsedScorebookCellValue): string | null {
  if (value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length === 0 || normalized === "#N/A" ? null : normalized;
}

function toNumber(value: ParsedScorebookCellValue): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toCount(value: ParsedScorebookCellValue): number | null {
  return value === null ? 0 : toNumber(value);
}

function toBooleanFlag(value: ParsedScorebookCellValue): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "x";
  }

  return false;
}
