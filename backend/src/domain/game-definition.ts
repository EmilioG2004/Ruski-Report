import {
  DisplayText,
  GameType,
  Metadata,
  ScorecardDefinitionId
} from "./common";

export type GameEventCategory =
  | "score"
  | "attempt"
  | "penalty"
  | "phase"
  | "system"
  | "custom";

export interface GameEventType extends DisplayText {
  id: string;
  category: GameEventCategory;
  affectsScore?: boolean;
  countsAsAttempt?: boolean;
  statKey?: string;
  metadata?: Metadata;
}

export interface GamePhaseDefinition extends DisplayText {
  id: string;
  sequence: number;
  isOvertime?: boolean;
  metadata?: Metadata;
}

export type StatScope = "player" | "team" | "match" | "tournament";
export type StatValueType = "count" | "number" | "percentage" | "duration";

export interface StatDefinition extends DisplayText {
  key: string;
  scope: StatScope;
  valueType: StatValueType;
  precision?: number;
  metadata?: Metadata;
}

export interface GameDefinition {
  gameType: GameType;
  displayName: string;
  phases: GamePhaseDefinition[];
  eventTypes: GameEventType[];
  stats: StatDefinition[];
  scorecardDefinitionId: ScorecardDefinitionId;
  metadata?: Metadata;
}
