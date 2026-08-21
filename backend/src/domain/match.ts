import { BoxScore } from "./box-score";
import { CommentsSummary } from "./comment";
import {
  BracketMatchId,
  GamePhaseId,
  GameType,
  ISODateTimeString,
  MatchId,
  Metadata,
  PlayerId,
  PodId,
  TeamId,
  TournamentId,
  VersionedRecord
} from "./common";
import { GameEvent } from "./event";
import { Scorecard } from "./scorecard";

export type MatchStatus =
  | "scheduled"
  | "in_progress"
  | "final"
  | "postponed"
  | "cancelled"
  | "forfeited";

export type MatchParticipantRole =
  | "home"
  | "away"
  | "higher_seed"
  | "lower_seed"
  | "neutral";

export type MatchResult = "win" | "loss" | "tie" | "pending";

export interface MatchParticipant {
  teamId: TeamId;
  role?: MatchParticipantRole;
  seed?: number;
  playerIds?: PlayerId[];
  score?: number;
  result?: MatchResult;
  metadata?: Metadata;
}

export interface MatchScore {
  participants: Array<{
    teamId: TeamId;
    score: number;
  }>;
  winnerTeamId?: TeamId;
  isFinal: boolean;
  metadata?: Metadata;
}

export interface GamePhase {
  id: GamePhaseId;
  type: string;
  label: string;
  sequence: number;
  status?: "pending" | "active" | "completed";
  startedAt?: ISODateTimeString;
  endedAt?: ISODateTimeString;
  metadata?: Metadata;
}

export interface MatchSummary extends VersionedRecord {
  id: MatchId;
  tournamentId: TournamentId;
  gameType: GameType;
  status: MatchStatus;
  participants: MatchParticipant[];
  score: MatchScore;
  podId?: PodId;
  bracketMatchId?: BracketMatchId;
  currentPhase?: GamePhase;
  scheduledAt?: ISODateTimeString;
  startedAt?: ISODateTimeString;
  endedAt?: ISODateTimeString;
  metadata?: Metadata;
}

export interface MatchDetail extends MatchSummary {
  boxScore: BoxScore;
  scorecard: Scorecard;
  events: GameEvent[];
  commentsSummary?: CommentsSummary;
}
