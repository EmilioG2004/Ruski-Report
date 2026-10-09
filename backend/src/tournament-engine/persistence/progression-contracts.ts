import { TransactionContext } from "../../repositories/transaction";
import {
  BracketId,
  BracketMatchId,
  BracketRoundId,
  MatchId,
  MatchRevisionId,
  MatchStatus,
  PodId,
  ScoreAvailability,
  TournamentId,
  TournamentLifecycle,
  TournamentTeamId
} from "../domain";
import {
  CalculatePodStandingsInput,
  PodStandingCalculation
} from "../standings";
import {
  ActivateMatchRevisionInput,
  EngineMetadata,
  MatchRevisionActivationResult
} from "./contracts";
import { CanonicalRevisionStatisticRefreshResult } from "./canonical-scoring-contracts";

export type ProgressionAdministratorId = string;

export interface ProgressionConfirmation {
  readonly confirmationDigest: string;
  readonly administratorId: ProgressionAdministratorId;
  readonly occurredAt: string;
}

export interface StandingRowIdentity {
  readonly rowId: string;
  readonly teamId: TournamentTeamId;
  readonly publicKey: string;
}

export interface PodStandingArtifactInput {
  readonly calculationId: string;
  readonly source: CalculatePodStandingsInput;
  readonly calculation: PodStandingCalculation;
  readonly rows: readonly StandingRowIdentity[];
  readonly createdAt: string;
  readonly metadata?: EngineMetadata;
}

export interface StandingResolutionCommandInput
extends ProgressionConfirmation {
  readonly commandId: string;
  readonly sourceCalculationId: string;
  readonly reason: string;
}

export interface ResolvePodTieInput extends ProgressionConfirmation {
  readonly commandId: string;
  readonly replacementCalculationId: string;
  readonly tournamentId: TournamentId;
  readonly podId: PodId;
  readonly expectedTournamentRowVersion: number;
  readonly activeCalculationId: string;
  readonly tieGroupId: string;
  readonly orderedTeamIds: readonly TournamentTeamId[];
  readonly reason: string;
}

export interface ActivatePodStandingsInput {
  readonly tournamentId: TournamentId;
  readonly podId: PodId;
  readonly expectedTournamentRowVersion: number;
  readonly artifact: PodStandingArtifactInput;
  readonly resolution?: StandingResolutionCommandInput;
  readonly activatedAt: string;
}

export interface ActivatePodStandingsResult {
  readonly tournamentId: TournamentId;
  readonly podId: PodId;
  readonly calculationId: string;
  readonly calculationStatus: PodStandingCalculation["status"];
  readonly lifecycle: TournamentLifecycle;
  readonly tournamentRowVersion: number;
}

export interface FinalizePodInput extends ProgressionConfirmation {
  readonly tournamentId: TournamentId;
  readonly podId: PodId;
  readonly expectedTournamentRowVersion: number;
  readonly calculationId: string;
  readonly finalizationId: string;
  readonly reason?: string;
  readonly metadata?: EngineMetadata;
}

export interface FinalizePodResult {
  readonly tournamentId: TournamentId;
  readonly podId: PodId;
  readonly finalizationId: string;
  readonly allPodsFinalized: boolean;
  readonly lifecycle: TournamentLifecycle;
  readonly tournamentRowVersion: number;
  readonly globalSeedReview?: GlobalSeedReviewResult;
}

export interface InvalidatePodFinalizationInput
extends ProgressionConfirmation {
  readonly invalidationId: string;
  readonly tournamentId: TournamentId;
  readonly podId: PodId;
  readonly expectedTournamentRowVersion: number;
  readonly replacementCalculationId: string;
  readonly correctionMatchId: MatchId;
  readonly correctionRevisionId: MatchRevisionId;
  readonly reason: string;
}

export interface SeedRowInput {
  readonly rowId: string;
  readonly publicKey: string;
  readonly teamId: TournamentTeamId;
  readonly calculatedSeed: number;
  readonly qualified: boolean;
  readonly metadata?: EngineMetadata;
}

export interface ActivateGlobalSeedsInput {
  readonly tournamentId: TournamentId;
  readonly expectedTournamentRowVersion: number;
  readonly calculationId: string;
  readonly inputDigest: string;
  readonly rulesVersion: number;
  readonly rows: readonly SeedRowInput[];
  readonly podFinalizationIds: readonly string[];
  readonly createdAt: string;
  readonly metadata?: EngineMetadata;
}

export interface ActiveSeedResult {
  readonly tournamentId: TournamentId;
  readonly calculationId: string;
  readonly effectiveSeeds: readonly EffectiveSeedRecord[];
  readonly tournamentRowVersion: number;
}

export interface GlobalSeedReviewResult {
  readonly reviewVersionId: string;
  readonly seedCalculationId: string;
  readonly status: "unresolved_tie" | "complete";
  readonly tournamentRowVersion: number;
  readonly tieGroups: readonly {
    readonly tieGroupId: string;
    readonly teamIds: readonly TournamentTeamId[];
    readonly resolved: boolean;
  }[];
  readonly activeSeeds?: ActiveSeedResult;
}

export interface ResolveGlobalSeedTieInput extends ProgressionConfirmation {
  readonly commandId: string;
  readonly reviewVersionId: string;
  readonly tournamentId: TournamentId;
  readonly expectedTournamentRowVersion: number;
  readonly activeReviewVersionId: string;
  readonly seedCalculationId: string;
  readonly tieGroupId: string;
  readonly orderedTeamIds: readonly TournamentTeamId[];
  readonly reason: string;
}

export interface SeedOverridePermutationRowInput {
  readonly teamId: TournamentTeamId;
  readonly previousSeed: number;
  readonly newSeed: number;
  readonly overrideId?: string;
}

export interface ApplySeedOverridePermutationInput
extends ProgressionConfirmation {
  readonly commandId: string;
  readonly tournamentId: TournamentId;
  readonly expectedTournamentRowVersion: number;
  readonly calculationId: string;
  readonly overrideDigest: string;
  readonly reason: string;
  readonly rows: readonly SeedOverridePermutationRowInput[];
  readonly metadata?: EngineMetadata;
}

export interface BracketSlotInput {
  readonly id: string;
  readonly publicKey: string;
  readonly slotNumber: 1 | 2;
  readonly sourceType: "team" | "match_winner" | "bye" | "tbd";
  readonly teamId?: TournamentTeamId;
  readonly sourceBracketMatchId?: BracketMatchId;
  readonly seed?: number;
  readonly metadata?: EngineMetadata;
}

export interface PlayoffMatchInput {
  readonly id: MatchId;
  readonly publicKey: string;
  readonly sequence: number;
  readonly scheduledAt?: string;
  readonly slots: readonly BracketSlotInput[];
  readonly metadata?: EngineMetadata;
}

export interface BracketNodeInput {
  readonly id: BracketMatchId;
  readonly publicKey: string;
  readonly sequence: number;
  readonly playable: boolean;
  readonly match?: PlayoffMatchInput;
  readonly slots: readonly BracketSlotInput[];
  readonly metadata?: EngineMetadata;
}

export interface BracketRoundInput {
  readonly id: BracketRoundId;
  readonly publicKey: string;
  readonly name: string;
  readonly sequence: number;
  readonly matches: readonly BracketNodeInput[];
  readonly metadata?: EngineMetadata;
}

export interface PublishBracketInput extends ProgressionConfirmation {
  readonly publicationId: string;
  readonly tournamentId: TournamentId;
  readonly expectedTournamentRowVersion: number;
  readonly seedCalculationId: string;
  readonly seedOverrideCommandId?: string;
  readonly cumulativeWorkbookId: string;
  readonly bracket: {
    readonly id: BracketId;
    readonly publicKey: string;
    readonly name: string;
    readonly bracketSize: number;
    readonly rounds: readonly BracketRoundInput[];
    readonly metadata?: EngineMetadata;
  };
  readonly metadata?: EngineMetadata;
}

export interface PublishBracketResult {
  readonly tournamentId: TournamentId;
  readonly bracketId: BracketId;
  readonly publicationId: string;
  readonly lifecycle: "playoffs" | "completed";
  readonly tournamentRowVersion: number;
  readonly playableMatchIds: readonly MatchId[];
}

export interface ResolveBracketMatchInput extends ProgressionConfirmation {
  readonly resolutionId: string;
  readonly advancementId?: string;
  readonly tournamentId: TournamentId;
  readonly expectedTournamentRowVersion: number;
  readonly bracketMatchId: BracketMatchId;
  readonly matchId?: MatchId;
  readonly revisionId?: MatchRevisionId;
  readonly winnerTeamId: TournamentTeamId;
  readonly resolutionType: "match_result" | "structural_bye";
  readonly matchStatus: "final" | "forfeited" | "bye";
}

export interface ResolveBracketMatchResult {
  readonly tournamentId: TournamentId;
  readonly bracketMatchId: BracketMatchId;
  readonly resolutionId: string;
  readonly advancedToBracketMatchId?: BracketMatchId;
  readonly tournamentCompleted: boolean;
  readonly tournamentRowVersion: number;
}

interface ReplacementPlayoffMatchBase {
  readonly replacementId: string;
  readonly bracketMatchId: BracketMatchId;
  readonly previousMatchId: MatchId;
  readonly reason: string;
}

export type ReplacementPlayoffMatchInput =
  | ReplacementPlayoffMatchBase & {
    readonly createWhenPlayable?: false;
    readonly match: PlayoffMatchInput;
  }
  | ReplacementPlayoffMatchBase & {
    readonly createWhenPlayable: true;
    readonly pendingMatch: Omit<PlayoffMatchInput, "slots">;
  };

export interface ReplaceStartedDependentMatchInput
extends ProgressionConfirmation {
  readonly tournamentId: TournamentId;
  readonly expectedTournamentRowVersion: number;
  readonly previousResolutionId: string;
  readonly correctedSource: {
    readonly activation: ActivateMatchRevisionInput;
    readonly rulesVersion: number;
    readonly resolutionId: string;
    readonly advancementId: string;
    readonly bracketMatchId: BracketMatchId;
    readonly winnerTeamId: TournamentTeamId;
    readonly matchStatus?: never;
  } | {
    readonly activation: ActivateMatchRevisionInput;
    readonly rulesVersion: number;
    readonly bracketMatchId: BracketMatchId;
    readonly matchStatus: "cancelled" | "postponed";
    readonly resolutionId?: never;
    readonly advancementId?: never;
    readonly winnerTeamId?: never;
  };
  readonly replacements: readonly ReplacementPlayoffMatchInput[];
}

export interface ReplaceStartedDependentMatchResult {
  readonly sourceActivation: MatchRevisionActivationResult;
  readonly statistics: CanonicalRevisionStatisticRefreshResult;
  readonly replacementMatchIds: readonly MatchId[];
  readonly tournamentRowVersion: number;
}

export interface ReplaceStartedDependentsForActiveCorrectionInput
extends ProgressionConfirmation {
  readonly tournamentId: TournamentId;
  readonly expectedTournamentRowVersion: number;
  readonly previousResolutionId: string;
  readonly correctedSource: {
    readonly resolutionId: string;
    readonly advancementId: string;
    readonly bracketMatchId: BracketMatchId;
    readonly matchId: MatchId;
    readonly revisionId: MatchRevisionId;
    readonly winnerTeamId: TournamentTeamId;
    readonly matchStatus: "final" | "forfeited";
  } | {
    readonly bracketMatchId: BracketMatchId;
    readonly matchId: MatchId;
    readonly revisionId: MatchRevisionId;
    readonly matchStatus: "cancelled" | "postponed";
    readonly resolutionId?: never;
    readonly advancementId?: never;
    readonly winnerTeamId?: never;
  };
  readonly replacements: readonly ReplacementPlayoffMatchInput[];
}

export interface ReplaceStartedDependentsForActiveCorrectionResult {
  readonly replacementMatchIds: readonly MatchId[];
  readonly tournamentRowVersion: number;
}

export interface RefreshProgressionAfterRevisionInput {
  readonly tournamentId: TournamentId;
  readonly matchId: MatchId;
  readonly revisionId: MatchRevisionId;
  readonly confirmationDigest: string;
  readonly actorId: ProgressionAdministratorId;
  readonly occurredAt: string;
}

export interface RefreshProgressionAfterRevisionResult {
  readonly stage: "pod_play" | "playoffs";
  readonly podCalculationId?: string;
  readonly invalidatedFinalizationId?: string;
  readonly bracketResolutionId?: string;
  readonly tournamentCompleted: boolean;
  readonly tournamentRowVersion: number;
}

export interface RecordOperatorMatchResolutionInput {
  readonly commandId: string;
  readonly tournamentId: TournamentId;
  readonly matchId: MatchId;
  readonly expectedTournamentRowVersion: number;
  readonly expectedMatchRowVersion: number;
  readonly commandType: "forfeit" | "cancel" | "postpone";
  readonly winnerTeamId?: TournamentTeamId;
  readonly reason: string;
  readonly revisionId: MatchRevisionId;
  readonly revisionPublicKey: string;
  readonly eventId: string;
  readonly rulesVersion: number;
  readonly confirmationDigest: string;
  readonly actorId: ProgressionAdministratorId;
  readonly occurredAt: string;
  readonly writerLeaseExpiresAt: string;
}

export interface PreviewOperatorMatchResolutionInput {
  readonly tournamentId: TournamentId;
  readonly matchId: MatchId;
  readonly expectedTournamentRowVersion: number;
  readonly expectedMatchRowVersion: number;
  readonly commandType: "forfeit" | "cancel" | "postpone";
  readonly winnerTeamId?: TournamentTeamId;
  readonly reason: string;
}

export interface OperatorMatchResolutionPreview {
  readonly tournamentId: TournamentId;
  readonly matchId: MatchId;
  readonly currentStatus: MatchStatus;
  readonly proposedStatus: "forfeited" | "cancelled" | "postponed";
  readonly proposedWinnerTeamId?: TournamentTeamId;
  readonly podId?: PodId;
  readonly activeFinalizationId?: string;
  readonly bracketMatchId?: BracketMatchId;
  readonly dependentBracketMatchIds: readonly BracketMatchId[];
  readonly requiresCascade: boolean;
  readonly confirmationDigest: string;
}

export interface RecordOperatorMatchResolutionResult {
  readonly activation: MatchRevisionActivationResult;
  readonly statistics: CanonicalRevisionStatisticRefreshResult;
  readonly progression: RefreshProgressionAfterRevisionResult;
}

export interface RecordOperatorMatchResolutionWithCascadeInput
extends RecordOperatorMatchResolutionInput {
  readonly cascadeConfirmationDigest: string;
  readonly previousResolutionId: string;
  readonly correctedResolutionId?: string;
  readonly correctedAdvancementId?: string;
  readonly replacements: readonly ReplacementPlayoffMatchInput[];
}

export interface RecordOperatorMatchResolutionWithCascadeResult
extends RecordOperatorMatchResolutionResult {
  readonly replacementMatchIds: readonly MatchId[];
}

export interface EffectiveSeedRecord {
  readonly teamId: TournamentTeamId;
  readonly calculatedSeed: number;
  readonly effectiveSeed: number;
  readonly overrideId?: string;
}

export interface ProgressionStandingRowRecord {
  readonly teamId: TournamentTeamId;
  readonly teamName: string;
  readonly rank: number | null;
  readonly wins: number;
  readonly losses: number;
  readonly cupDifferential: number;
  readonly makes: number | null;
  readonly attempts: number | null;
  readonly shootingPercentage: number | null;
  readonly qualified: boolean;
  readonly tieGroupId?: string;
  readonly administratorResolution?: string;
}

export interface PodProgressionRecord {
  readonly podId: PodId;
  readonly publicKey: string;
  readonly name: string;
  readonly sequence: number;
  readonly activeCalculationId?: string;
  readonly calculationStatus?: PodStandingCalculation["status"];
  readonly rows: readonly ProgressionStandingRowRecord[];
  readonly tieGroups: readonly {
    readonly tieGroupId: string;
    readonly teamIds: readonly TournamentTeamId[];
    readonly resolved: boolean;
  }[];
  readonly activeFinalizationId?: string;
  readonly finalizedAt?: string;
}

export interface BracketSlotRecord {
  readonly slotNumber: 1 | 2;
  readonly sourceType: BracketSlotInput["sourceType"];
  readonly teamId?: TournamentTeamId;
  readonly teamName?: string;
  readonly sourceBracketMatchId?: BracketMatchId;
  readonly seed?: number;
}

export interface BracketMatchRecord {
  readonly bracketMatchId: BracketMatchId;
  readonly publicKey: string;
  readonly sequence: number;
  readonly playable: boolean;
  readonly matchId?: MatchId;
  readonly instanceNumber?: number;
  readonly participantTeamIds?: readonly [TournamentTeamId, TournamentTeamId];
  readonly participantsFrozen?: boolean;
  readonly matchStatus?: MatchStatus;
  readonly scoreAvailability?: ScoreAvailability;
  readonly winnerTeamId?: TournamentTeamId;
  readonly resolutionId?: string;
  readonly slots: readonly BracketSlotRecord[];
}

export interface BracketRoundRecord {
  readonly roundId: BracketRoundId;
  readonly publicKey: string;
  readonly name: string;
  readonly sequence: number;
  readonly matches: readonly BracketMatchRecord[];
}

export interface TournamentProgressionRecord {
  readonly tournamentId: TournamentId;
  readonly lifecycle: TournamentLifecycle;
  readonly rowVersion: number;
  readonly qualifiersPerPod: number;
  readonly bracketSize: number;
  readonly pods: readonly PodProgressionRecord[];
  readonly activeGlobalSeedReview?: {
    readonly reviewVersionId: string;
    readonly seedCalculationId: string;
    readonly inputDigest: string;
    readonly rulesVersion: number;
    readonly status: "unresolved_tie" | "complete";
    readonly tieGroups: readonly {
      readonly tieGroupId: string;
      readonly teamIds: readonly TournamentTeamId[];
      readonly resolved: boolean;
    }[];
  };
  readonly activeSeedCalculationId?: string;
  readonly effectiveSeeds: readonly EffectiveSeedRecord[];
  readonly activeSeedOverrideCommandId?: string;
  readonly activeSeedOverride?: {
    readonly commandId: string;
    readonly reason: string;
    readonly administratorId: string;
    readonly occurredAt: string;
    readonly overrideDigest: string;
  };
  readonly activeBracket?: {
    readonly bracketId: BracketId;
    readonly publicKey: string;
    readonly name: string;
    readonly status: "draft" | "published" | "completed";
    readonly cumulativeWorkbookId: string;
    readonly rounds: readonly BracketRoundRecord[];
  };
}

export interface TournamentProgressionRepositoryContract {
  readProgression(tournamentId: TournamentId): Promise<TournamentProgressionRecord | null>;
  activatePodStandings(input: ActivatePodStandingsInput): Promise<ActivatePodStandingsResult>;
  resolvePodTie(input: ResolvePodTieInput): Promise<ActivatePodStandingsResult>;
  finalizePod(input: FinalizePodInput): Promise<FinalizePodResult>;
  invalidatePodFinalization(input: InvalidatePodFinalizationInput): Promise<ActivatePodStandingsResult>;
  activateGlobalSeeds(input: ActivateGlobalSeedsInput): Promise<ActiveSeedResult>;
  resolveGlobalSeedTie(input: ResolveGlobalSeedTieInput): Promise<GlobalSeedReviewResult>;
  applySeedOverridePermutation(input: ApplySeedOverridePermutationInput): Promise<ActiveSeedResult>;
  publishBracket(input: PublishBracketInput): Promise<PublishBracketResult>;
  resolveBracketMatch(input: ResolveBracketMatchInput): Promise<ResolveBracketMatchResult>;
  replaceStartedDependentMatch(
    input: ReplaceStartedDependentMatchInput
  ): Promise<ReplaceStartedDependentMatchResult>;
  previewOperatorMatchResolution(
    input: PreviewOperatorMatchResolutionInput
  ): Promise<OperatorMatchResolutionPreview>;
  recordOperatorMatchResolution(
    input: RecordOperatorMatchResolutionInput
  ): Promise<RecordOperatorMatchResolutionResult>;
  recordOperatorMatchResolutionWithCascade(
    input: RecordOperatorMatchResolutionWithCascadeInput
  ): Promise<RecordOperatorMatchResolutionWithCascadeResult>;
  refreshProgressionAfterRevisionInTransaction(
    input: RefreshProgressionAfterRevisionInput,
    transaction: TransactionContext
  ): Promise<RefreshProgressionAfterRevisionResult>;
  replaceStartedDependentsForActiveCorrectionInTransaction(
    input: ReplaceStartedDependentsForActiveCorrectionInput,
    transaction: TransactionContext
  ): Promise<ReplaceStartedDependentsForActiveCorrectionResult>;
}
