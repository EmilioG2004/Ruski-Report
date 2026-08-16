import { GameType, MatchId, Metadata, PlayerId, TeamId } from "./common";

export type BoxScoreSubjectType = "player" | "team" | "match";
export type BoxScoreStatValue = number | null;

export interface BoxScoreSubject {
  type: BoxScoreSubjectType;
  label: string;
  playerId?: PlayerId;
  teamId?: TeamId;
}

export interface BoxScoreRow {
  subject: BoxScoreSubject;
  stats: Record<string, BoxScoreStatValue>;
  metadata?: Metadata;
}

export interface BoxScore {
  matchId: MatchId;
  gameType: GameType;
  rows: BoxScoreRow[];
  totals?: Record<string, BoxScoreStatValue>;
  metadata?: Metadata;
}
