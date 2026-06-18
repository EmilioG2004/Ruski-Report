import { GameType, Metadata } from "../domain";

export type ScorebookSheetKind =
  | "summary"
  | "template"
  | "game"
  | "data"
  | "bracket";

export type ScorebookCellAddress = string;

export interface ScorebookCellRange {
  start: ScorebookCellAddress;
  end: ScorebookCellAddress;
}

export interface ScorebookHeaderCell {
  key: string;
  label: string;
  cell: ScorebookCellAddress;
  required?: boolean;
  metadata?: Metadata;
}

export interface ScorebookHeaderGroup {
  id: string;
  label: string;
  headers: readonly ScorebookHeaderCell[];
  metadata?: Metadata;
}

export type ScorebookHeaderMismatchReason = "missing" | "renamed";

export interface ScorebookHeaderMismatch {
  groupId: string;
  cell: ScorebookCellAddress;
  expected: string;
  actual: string | null;
  reason: ScorebookHeaderMismatchReason;
}

export type ScorebookCellReader = (cell: ScorebookCellAddress) => unknown;

export interface ScorebookSummarySheetSchema {
  sheetName: string;
  kind: Extract<ScorebookSheetKind, "summary" | "data" | "bracket">;
  required: boolean;
  headerRow?: number;
  headers: readonly ScorebookHeaderCell[];
  dataRange?: ScorebookCellRange;
  metadata?: Metadata;
}

export interface ScorebookSideSchema {
  id: string;
  label: string;
  shooterLabelCells: readonly ScorebookCellAddress[];
  playerNameCells: readonly ScorebookCellAddress[];
  statSummaryHeaders: readonly ScorebookHeaderCell[];
  statSummaryValuesRange: ScorebookCellRange;
  shootingPercentageCells?: readonly ScorebookCellAddress[];
  shotHeaders: readonly ScorebookHeaderCell[];
  shotRowsRange: ScorebookCellRange;
  metadata?: Metadata;
}

export interface ScorebookScorecardSheetSchema {
  kind: Extract<ScorebookSheetKind, "template" | "game">;
  sheetName?: string;
  statusCell: ScorebookCellAddress;
  allowedStatusValues: readonly string[];
  sides: readonly ScorebookSideSchema[];
  requiredHeaderGroups: readonly ScorebookHeaderGroup[];
  metadata?: Metadata;
}

export interface ScorebookDynamicSheetRule {
  id: string;
  kind: Extract<ScorebookSheetKind, "game">;
  excludeSheetNames: readonly string[];
  requiredHeaderGroups: readonly ScorebookHeaderGroup[];
  metadata?: Metadata;
}

export interface ScorebookSchema {
  gameType: GameType;
  requiredSheetNames: readonly string[];
  summarySheets: readonly ScorebookSummarySheetSchema[];
  blankScorecard: ScorebookScorecardSheetSchema;
  gameSheets: ScorebookDynamicSheetRule;
  metadata?: Metadata;
}

export function findScorebookHeaderMismatches(
  groups: readonly ScorebookHeaderGroup[],
  readCell: ScorebookCellReader
): ScorebookHeaderMismatch[] {
  return groups.flatMap((group) =>
    group.headers.flatMap((header) => {
      const actual = normalizeHeaderValue(readCell(header.cell));

      if (actual === header.label) {
        return [];
      }

      return [
        {
          groupId: group.id,
          cell: header.cell,
          expected: header.label,
          actual,
          reason: actual === null ? "missing" : "renamed"
        }
      ];
    })
  );
}

function normalizeHeaderValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length === 0 ? null : normalized;
}
