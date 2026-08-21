export type AdminOperatorMatchCommand = "forfeit" | "cancel" | "postpone";

export interface PreviewAdminMatchResolutionRequest {
  expectedTournamentRowVersion?: unknown;
  expectedMatchRowVersion?: unknown;
  commandType?: unknown;
  winnerTeamId?: unknown;
  reason?: unknown;
}

export interface ApplyAdminMatchResolutionRequest
extends PreviewAdminMatchResolutionRequest {
  confirmationDigest?: unknown;
  cascadeConfirmationDigest?: unknown;
}

export interface ResolveAdminStandingTieRequest {
  expectedTournamentRowVersion?: unknown;
  activeCalculationId?: unknown;
  tieGroupId?: unknown;
  orderedTeamIds?: unknown;
  reason?: unknown;
  confirmationDigest?: unknown;
}

export interface FinalizeAdminPodRequest {
  expectedTournamentRowVersion?: unknown;
  calculationId?: unknown;
  reason?: unknown;
  confirmationDigest?: unknown;
}

export interface ResolveAdminGlobalSeedTieRequest {
  expectedTournamentRowVersion?: unknown;
  activeReviewVersionId?: unknown;
  seedCalculationId?: unknown;
  tieGroupId?: unknown;
  orderedTeamIds?: unknown;
  reason?: unknown;
  confirmationDigest?: unknown;
}

export interface OverrideAdminSeedOrderRequest {
  expectedTournamentRowVersion?: unknown;
  calculationId?: unknown;
  orderedTeamIds?: unknown;
  reason?: unknown;
  confirmationDigest?: unknown;
}

export interface PreviewAdminBracketRequest {
  expectedTournamentRowVersion?: unknown;
}

export interface PublishAdminBracketRequest
extends PreviewAdminBracketRequest {
  confirmationDigest?: unknown;
}

export interface AdminBracketPreviewResponse {
  tournamentId: string;
  tournamentRowVersion: number;
  seedCalculationId: string;
  bracketId: string;
  topologyDigest: string;
  confirmationDigest: string;
  bracketSize: number;
  qualifierCount: number;
  roundCount: number;
  playableMatchCount: number;
  byeCount: number;
  placementOrder: readonly number[];
}
