import {
  MatchId,
  PodId,
  TournamentId,
  TournamentTeamId
} from "./ids";

export type TournamentStage = "pod_play" | "playoffs";

export type MatchStatus =
  | "scheduled"
  | "in_progress"
  | "final"
  | "postponed"
  | "forfeited"
  | "cancelled";

export type ScoreAvailability =
  | "not_started"
  | "partial"
  | "complete"
  | "unrecorded"
  | "not_applicable";

export type ScoringWriterMode =
  | "excel_import"
  | "in_app_live"
  | "operator_correction";

export interface CanonicalMatchIdentity {
  readonly id: MatchId;
  readonly tournamentId: TournamentId;
  readonly stage: TournamentStage;
  readonly participantTeamIds: readonly TournamentTeamId[];
  readonly podId?: PodId;
}
