import {
  GameEventId,
  GamePhaseId,
  GameType,
  MatchId,
  Metadata,
  PlayerId,
  ScorecardDefinitionId,
  ScorecardRowId,
  TeamId
} from "./common";

export type ScorecardColumnDataType =
  | "text"
  | "number"
  | "boolean"
  | "event"
  | "team"
  | "player"
  | "timestamp"
  | "custom";

export interface ScorecardColumnDefinition {
  key: string;
  label: string;
  shortLabel?: string;
  dataType: ScorecardColumnDataType;
  required?: boolean;
  eventTypeIds?: string[];
  statKey?: string;
  metadata?: Metadata;
}

export interface ScorecardDefinition {
  id: ScorecardDefinitionId;
  gameType: GameType;
  name: string;
  columns: ScorecardColumnDefinition[];
  rowLabel?: string;
  metadata?: Metadata;
}

export type ScorecardCellValue = string | number | boolean | null;

export interface ScorecardRow {
  id: ScorecardRowId;
  matchId: MatchId;
  sequence: number;
  phaseId?: GamePhaseId;
  teamId?: TeamId;
  playerId?: PlayerId;
  values: Record<string, ScorecardCellValue>;
  eventIds?: GameEventId[];
  metadata?: Metadata;
}

export interface Scorecard {
  definition: ScorecardDefinition;
  rows: ScorecardRow[];
}
