import { Metadata, PodId, StandingId, TeamId, TournamentId } from "./common";

export type StandingScope = "pod" | "tournament";

export interface TeamRecord {
  wins: number;
  losses: number;
  ties?: number;
}

export interface Standing {
  id: StandingId;
  tournamentId: TournamentId;
  scope: StandingScope;
  teamId: TeamId;
  rank: number;
  record: TeamRecord;
  gamesPlayed: number;
  points?: number;
  podId?: PodId;
  metricValues?: Record<string, number | null>;
  metadata?: Metadata;
}
