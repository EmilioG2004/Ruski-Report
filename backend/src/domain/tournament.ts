import { Bracket } from "./bracket";
import {
  GameType,
  MatchId,
  Metadata,
  PodId,
  StandingId,
  TeamId,
  TournamentId,
  VersionedRecord
} from "./common";
import { MatchSummary } from "./match";
import { Standing } from "./standing";
import { Team } from "./team";

export type TournamentStatus =
  | "scheduled"
  | "active"
  | "completed"
  | "archived";

export type TournamentFormatType =
  | "pod_and_bracket"
  | "round_robin"
  | "single_elimination"
  | "double_elimination"
  | "custom";

export interface TournamentFormat {
  type: TournamentFormatType;
  podCount?: number;
  teamsPerPod?: number;
  bracketSize?: number;
  description?: string;
  metadata?: Metadata;
}

export interface Pod {
  id: PodId;
  tournamentId: TournamentId;
  name: string;
  sequence: number;
  teamIds: TeamId[];
  matchIds?: MatchId[];
  standingIds?: StandingId[];
  metadata?: Metadata;
}

export interface TournamentSummary extends VersionedRecord {
  id: TournamentId;
  year: number;
  name: string;
  gameType: GameType;
  status: TournamentStatus;
  format: TournamentFormat;
  activeMatchIds: MatchId[];
  featuredMatchIds: MatchId[];
  metadata?: Metadata;
}

export interface Tournament extends TournamentSummary {
  pods: Pod[];
  teams: Team[];
  standings: Standing[];
  bracket?: Bracket;
  matchSummaries: MatchSummary[];
}
