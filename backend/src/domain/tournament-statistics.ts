import { Metadata, PlayerId, TeamId } from "./common";

export type TournamentStatisticScope = "season" | "playoffs";
export type TournamentStatisticSubjectType = "player" | "team";

export interface TournamentStatisticSubject {
  type: TournamentStatisticSubjectType;
  label: string;
  playerId?: PlayerId;
  teamId?: TeamId;
  metadata?: Metadata;
}

export interface TournamentStatisticRow {
  rank: number;
  subject: TournamentStatisticSubject;
  values: Record<string, number | null>;
  metadata?: Metadata;
}

export interface TournamentStatisticTable {
  id: string;
  name: string;
  scope: TournamentStatisticScope;
  subjectType: TournamentStatisticSubjectType;
  statKeys: string[];
  rows: TournamentStatisticRow[];
  metadata?: Metadata;
}
