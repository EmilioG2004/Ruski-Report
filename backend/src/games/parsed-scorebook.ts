import { GameType, Metadata } from "../domain";

export type ScorebookSheetRole =
  | "bracket"
  | "summary"
  | "template"
  | "game"
  | "data"
  | "unknown";

export interface ScorebookSource {
  originalName: string;
  mimeType?: string;
  sizeBytes?: number;
  checksum?: string;
  metadata?: Metadata;
}

export type ParsedScorebookCellValue = string | number | boolean | null;

export interface ParsedScorebookRow {
  rowNumber: number;
  values: Record<string, ParsedScorebookCellValue>;
  metadata?: Metadata;
}

export interface ParsedScorebookPlayer {
  slot: number;
  name: string;
  sourceCell: string;
}

export interface ParsedScorebookStatLine {
  playerSlot: number;
  playerName: string | null;
  stats: Record<string, number | null>;
  sourceCells: Record<string, string>;
}

export interface ParsedScorebookShotRow {
  rowNumber: number;
  shotNumber: number | null;
  shooterName: string | null;
  eventFlags: Record<string, boolean>;
  sourceCells: Record<string, string>;
}

export interface ParsedScorebookSide {
  id: string;
  label: string;
  players: ParsedScorebookPlayer[];
  boxScoreTotals: ParsedScorebookStatLine[];
  shotRows: ParsedScorebookShotRow[];
}

export interface ParsedScorebookGameSheet {
  status: string | null;
  sides: ParsedScorebookSide[];
}

export interface ParsedScorebookSheet {
  name: string;
  index: number;
  role: ScorebookSheetRole;
  rows?: ParsedScorebookRow[];
  game?: ParsedScorebookGameSheet;
  metadata?: Metadata;
}

export interface ParsedScorebook {
  gameType: GameType;
  source: ScorebookSource;
  sheets: ParsedScorebookSheet[];
  metadata?: Metadata;
}
