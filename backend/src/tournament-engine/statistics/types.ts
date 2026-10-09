export type CanonicalStatisticScope = "match" | "pod" | "tournament";
export type CanonicalStatisticStage = "pod" | "playoff" | "all";
export type CanonicalStatisticSubjectType = "player" | "team";

export type CanonicalStatisticMetric =
  | "makes"
  | "misses"
  | "attempts"
  | "shooting_percentage"
  | "splash_outs"
  | "guys"
  | "tris"
  | "dis"
  | "voms"
  | "cups_scored"
  | "cups_against"
  | "cup_differential";

export interface CanonicalStatisticRevisionPlayer {
  readonly playerId: string;
  readonly rosterMembershipId: string | null;
  readonly rosterSlot: number;
}

export interface CanonicalStatisticRevisionTeam {
  readonly sideNumber: 1 | 2;
  readonly teamId: string;
  readonly players: readonly CanonicalStatisticRevisionPlayer[];
}

export interface CanonicalStatisticShotAttempt {
  readonly outcome: "make" | "miss";
  readonly classification?: "guy" | "di" | "tri" | "splash_out";
  readonly cupDelta: number;
}

export interface CanonicalStatisticEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly type:
    | "shot_attempt"
    | "vom"
    | "forfeit"
    | "cancellation"
    | "postponement"
    | "phase_transition"
    | "operator_correction";
  readonly teamId?: string;
  readonly playerId?: string;
  readonly shotAttempt?: CanonicalStatisticShotAttempt;
}

export interface CanonicalStatisticRevision {
  readonly tournamentId: string;
  readonly matchId: string;
  readonly revisionId: string;
  readonly stage: "pod_play" | "playoffs";
  readonly podId?: string;
  readonly teams: readonly CanonicalStatisticRevisionTeam[];
  readonly events: readonly CanonicalStatisticEvent[];
}

export interface CanonicalStatisticUniverseTeam {
  readonly teamId: string;
  readonly podId: string;
  readonly playerIds: readonly string[];
}

export interface CanonicalStatisticUniverse {
  readonly tournamentId: string;
  readonly teams: readonly CanonicalStatisticUniverseTeam[];
}

export interface CanonicalStatisticValue {
  readonly scope: CanonicalStatisticScope;
  readonly matchId?: string;
  readonly podId?: string;
  readonly stage: CanonicalStatisticStage;
  readonly subjectType: CanonicalStatisticSubjectType;
  readonly subjectId: string;
  readonly metric: CanonicalStatisticMetric;
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly value: number | null;
}

export interface CanonicalStatisticCalculation {
  readonly inputDigest: string;
  readonly rulesVersion: number;
  readonly values: readonly CanonicalStatisticValue[];
}
