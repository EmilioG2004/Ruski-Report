import { ScorebookCellRange } from "./scorebook-schema";

export interface ScorebookCellCoordinate {
  column: number;
  row: number;
}

export interface ScorebookRowRange {
  rowNumber: number;
  cells: string[];
}

export function parseCellAddress(address: string): ScorebookCellCoordinate {
  const match = /^([A-Z]+)(\d+)$/.exec(address);

  if (match === null) {
    throw new Error(`Invalid scorebook cell address: ${address}`);
  }

  return {
    column: columnNameToNumber(match[1]),
    row: Number(match[2])
  };
}

export function formatCellAddress(coordinate: ScorebookCellCoordinate): string {
  if (coordinate.column < 1 || coordinate.row < 1) {
    throw new Error(
      `Invalid scorebook cell coordinate: ${coordinate.column}, ${coordinate.row}`
    );
  }

  return `${columnNumberToName(coordinate.column)}${coordinate.row}`;
}

export function expandCellRangeRows(
  range: ScorebookCellRange
): ScorebookRowRange[] {
  const start = parseCellAddress(range.start);
  const end = parseCellAddress(range.end);
  const rows: ScorebookRowRange[] = [];

  for (let row = start.row; row <= end.row; row += 1) {
    const cells: string[] = [];

    for (let column = start.column; column <= end.column; column += 1) {
      cells.push(`${columnNumberToName(column)}${row}`);
    }

    rows.push({
      rowNumber: row,
      cells
    });
  }

  return rows;
}

function columnNameToNumber(columnName: string): number {
  return columnName.split("").reduce((column, character) => {
    return column * 26 + character.charCodeAt(0) - "A".charCodeAt(0) + 1;
  }, 0);
}

function columnNumberToName(columnNumber: number): string {
  let remaining = columnNumber;
  let columnName = "";

  while (remaining > 0) {
    const offset = (remaining - 1) % 26;
    columnName = String.fromCharCode("A".charCodeAt(0) + offset) + columnName;
    remaining = Math.floor((remaining - 1) / 26);
  }

  return columnName;
}
