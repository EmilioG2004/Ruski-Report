import {
  PodId,
  TournamentId,
  TournamentTeamId
} from "../domain";

export const GLOBAL_QUALIFIER_SEEDING_RULES_VERSION = 1;

export interface GlobalQualifierStandingInput {
  readonly teamId: TournamentTeamId;
  readonly podId: PodId;
  readonly podRank: number;
  readonly wins: number;
  readonly losses: number;
  readonly cupDifferential: number;
  readonly makes: number;
  readonly attempts: number;
  readonly shootingPercentage: number | null;
}

export interface GlobalQualifierTieResolution {
  readonly resolutionId: string;
  readonly tieGroupId: string;
  readonly orderedTeamIds: readonly TournamentTeamId[];
  readonly reason: string;
  readonly resolvedBy: string;
  readonly resolvedAt: string;
}

export interface CalculateGlobalQualifierSeedsInput {
  readonly tournamentId: TournamentId;
  readonly seedCalculationId: string;
  readonly rulesVersion: number;
  readonly qualifiersPerPod: number;
  readonly qualifiers: readonly GlobalQualifierStandingInput[];
  readonly tieResolutions?: readonly GlobalQualifierTieResolution[];
}

export interface AppliedGlobalQualifierTieResolution {
  readonly resolutionId: string;
  readonly order: number;
  readonly reason: string;
  readonly resolvedBy: string;
  readonly resolvedAt: string;
}

export interface GlobalQualifierSeedRow
  extends GlobalQualifierStandingInput {
  readonly calculatedSeed: number | null;
  readonly seedRange: readonly [number, number];
  readonly tieGroupId?: string;
  readonly administratorResolution?: AppliedGlobalQualifierTieResolution;
}

export interface GlobalQualifierTieGroup {
  readonly tieGroupId: string;
  readonly teamIds: readonly TournamentTeamId[];
  readonly seedRange: readonly [number, number];
  readonly wins: number;
  readonly losses: number;
  readonly cupDifferential: number;
  readonly shootingPercentageNumerator: number;
  readonly shootingPercentageDenominator: number;
  readonly shootingPercentage: number | null;
  readonly resolved: boolean;
  readonly resolutionId?: string;
}

export interface GlobalQualifierSeedCalculation {
  readonly tournamentId: TournamentId;
  readonly seedCalculationId: string;
  readonly rulesVersion: number;
  readonly inputDigest: string;
  readonly status: "unresolved_tie" | "complete";
  readonly rows: readonly GlobalQualifierSeedRow[];
  readonly tieGroups: readonly GlobalQualifierTieGroup[];
}

export interface EffectiveSeedAuditInput {
  readonly overrideId: string;
  readonly reason: string;
  readonly overriddenBy: string;
  readonly overriddenAt: string;
}

export interface ApplyEffectiveSeedPermutationOverrideInput {
  readonly calculation: GlobalQualifierSeedCalculation;
  readonly orderedTeamIds: readonly TournamentTeamId[];
  readonly audit: EffectiveSeedAuditInput;
}

export interface EffectiveSeedRow {
  readonly teamId: TournamentTeamId;
  readonly podId: PodId;
  readonly calculatedSeed: number;
  readonly effectiveSeed: number;
}

export interface EffectiveSeedChange {
  readonly teamId: TournamentTeamId;
  readonly previousSeed: number;
  readonly newSeed: number;
}

export interface EffectiveSeedPlan {
  readonly tournamentId: TournamentId;
  readonly seedCalculationId: string;
  readonly seedCalculationInputDigest: string;
  readonly source: "calculated" | "administrator_override";
  readonly overrideDigest: string | null;
  readonly audit: EffectiveSeedAuditInput | null;
  readonly rows: readonly EffectiveSeedRow[];
  readonly changes: readonly EffectiveSeedChange[];
}

export interface SeedingValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}
