export type ISODateTimeString = string;
export type Metadata = Record<string, unknown>;

export type BracketId = string;
export type BracketMatchId = string;
export type BracketRoundId = string;
export type CommentId = string;
export type CommentReportId = string;
export type GameEventId = string;
export type GamePhaseId = string;
export type GameType = string;
export type LiveUpdateEventId = string;
export type MatchId = string;
export type PlayerId = string;
export type PodId = string;
export type ScorecardDefinitionId = string;
export type ScorecardRowId = string;
export type StandingId = string;
export type TeamId = string;
export type TournamentId = string;
export type UserId = string;

export interface VersionedRecord {
  version: number;
  updatedAt: ISODateTimeString;
}

export interface DisplayText {
  label: string;
  shortLabel?: string;
  description?: string;
}
