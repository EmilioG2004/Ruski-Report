import { GameType, Metadata } from "../domain";

export type ScorebookSheetRole =
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

export interface ParsedScorebookSheet {
  name: string;
  index: number;
  role: ScorebookSheetRole;
  rows?: unknown[];
  metadata?: Metadata;
}

export interface ParsedScorebook {
  gameType: GameType;
  source: ScorebookSource;
  sheets: ParsedScorebookSheet[];
  metadata?: Metadata;
}
