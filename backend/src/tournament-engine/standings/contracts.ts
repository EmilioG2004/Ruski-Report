import {
  MatchId,
  MatchRevisionId,
  MatchStatus,
  PodId,
  ScoreAvailability,
  TournamentId,
  TournamentTeamId
} from "../domain";

export const POD_STANDINGS_RULES_VERSION = 1;

export type PodStandingTeamResult =
  | "pending"
  | "win"
  | "loss"
  | "tie"
  | "cancelled"
  | "forfeited";

export interface PodStandingTeamInput {
  readonly teamId: TournamentTeamId;
  readonly initialSeed: number;
}

export interface PodStandingMatchTeamInput {
  readonly teamId: TournamentTeamId;
  readonly result: PodStandingTeamResult;
  readonly score: number | null;
  readonly makes: number;
  readonly attempts: number;
  readonly cupsScored: number;
  readonly cupsAgainst: number;
}

export interface PodStandingMatchInput {
  readonly matchId: MatchId;
  readonly revisionId?: MatchRevisionId;
  readonly statisticRunId?: string;
  readonly statisticInputDigest?: string;
  readonly status: MatchStatus;
  readonly scoreAvailability: ScoreAvailability;
  readonly teams: readonly [
    PodStandingMatchTeamInput,
    PodStandingMatchTeamInput
  ];
}

export interface PodStandingTieResolution {
  readonly resolutionId: string;
  readonly tieGroupId: string;
  readonly orderedTeamIds: readonly TournamentTeamId[];
  readonly reason: string;
  readonly resolvedBy: string;
  readonly resolvedAt: string;
}

export interface CalculatePodStandingsInput {
  readonly tournamentId: TournamentId;
  readonly podId: PodId;
  readonly rulesVersion: number;
  readonly gamesPerPair: number;
  readonly qualifiersPerPod: number;
  readonly teams: readonly PodStandingTeamInput[];
  readonly matches: readonly PodStandingMatchInput[];
  readonly tieResolutions?: readonly PodStandingTieResolution[];
}

export type PodStandingCalculationStatus =
  | "provisional"
  | "unresolved_tie"
  | "finalizable";

export type PodStandingMatchDisposition =
  | "included_final"
  | "included_forfeit"
  | "excluded_cancelled"
  | "blocking";

export type PodStandingBlockingReason =
  | "scheduled"
  | "postponed"
  | "in_progress"
  | "final_unrecorded";

export interface PodStandingMatchCalculationInput {
  readonly matchId: MatchId;
  readonly revisionId: MatchRevisionId | null;
  readonly statisticRunId: string | null;
  readonly statisticInputDigest: string | null;
  readonly status: MatchStatus;
  readonly scoreAvailability: ScoreAvailability;
  readonly disposition: PodStandingMatchDisposition;
  readonly blockingReason?: PodStandingBlockingReason;
}

export interface AppliedPodStandingTieResolution {
  readonly resolutionId: string;
  readonly order: number;
  readonly reason: string;
  readonly resolvedBy: string;
  readonly resolvedAt: string;
}

export interface PodStandingRow {
  readonly teamId: TournamentTeamId;
  readonly initialSeed: number;
  readonly displayOrder: number;
  readonly rank: number | null;
  readonly wins: number;
  readonly losses: number;
  readonly cupDifferential: number;
  readonly makes: number;
  readonly attempts: number;
  readonly shootingPercentage: number | null;
  readonly qualified: boolean;
  readonly tieGroupId?: string;
  readonly administratorResolution?: AppliedPodStandingTieResolution;
}

export interface PodStandingTieGroup {
  readonly tieGroupId: string;
  readonly teamIds: readonly TournamentTeamId[];
  readonly wins: number;
  readonly losses: number;
  readonly cupDifferential: number;
  readonly shootingPercentageNumerator: number;
  readonly shootingPercentageDenominator: number;
  readonly shootingPercentage: number | null;
  readonly resolved: boolean;
  readonly resolutionId?: string;
}

export interface PodStandingCalculation {
  readonly inputDigest: string;
  readonly rulesVersion: number;
  readonly status: PodStandingCalculationStatus;
  readonly rows: readonly PodStandingRow[];
  readonly tieGroups: readonly PodStandingTieGroup[];
  readonly matchInputs: readonly PodStandingMatchCalculationInput[];
  readonly scheduledMatchCount: number;
  readonly requiredMatchCount: number;
  readonly resolvedRequiredMatchCount: number;
  readonly cancelledMatchCount: number;
  readonly blockingMatchIds: readonly MatchId[];
}

export interface PodStandingsValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}
