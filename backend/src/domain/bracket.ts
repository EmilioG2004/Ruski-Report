import {
  BracketId,
  BracketMatchId,
  BracketRoundId,
  MatchId,
  Metadata,
  TeamId,
  TournamentId
} from "./common";

export type BracketMatchStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "pending";

export type BracketSlotSourceType =
  | "team"
  | "match-winner"
  | "match-loser"
  | "bye"
  | "tbd";

export interface BracketSlotSource {
  type: BracketSlotSourceType;
  sourceMatchId?: BracketMatchId;
  label?: string;
}

export interface BracketSlot {
  seed?: number;
  teamId?: TeamId;
  source?: BracketSlotSource;
  metadata?: Metadata;
}

export interface BracketMatch {
  id: BracketMatchId;
  matchId?: MatchId;
  sequence: number;
  status: BracketMatchStatus;
  slots: BracketSlot[];
  winnerTeamId?: TeamId;
  metadata?: Metadata;
}

export interface BracketRound {
  id: BracketRoundId;
  name: string;
  sequence: number;
  matches: BracketMatch[];
  metadata?: Metadata;
}

export interface Bracket {
  id: BracketId;
  tournamentId: TournamentId;
  name: string;
  rounds: BracketRound[];
  metadata?: Metadata;
}
