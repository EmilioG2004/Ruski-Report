import {
  BracketId,
  BracketMatchId,
  BracketRoundId,
  MatchId,
  MatchStatus,
  PodId,
  ScoreAvailability,
  TournamentId,
  TournamentTeamId
} from "../domain";
import { EffectiveSeedPlan } from "../seeding";

export const SINGLE_ELIMINATION_BRACKET_RULES_VERSION = 1;

export interface GenerateMirroredBracketTopologyInput {
  readonly tournamentId: TournamentId;
  readonly rulesVersion: number;
  readonly bracketSize: number;
  readonly allowByes: boolean;
  readonly effectiveSeedPlan: EffectiveSeedPlan;
}

export interface BracketSeedEntry {
  readonly teamId: TournamentTeamId;
  readonly podId: PodId;
  readonly calculatedSeed: number;
  readonly effectiveSeed: number;
}

export type BracketSlotSource =
  | {
      readonly type: "seed";
      readonly seed: number;
    }
  | {
      readonly type: "winner";
      readonly bracketMatchId: BracketMatchId;
    };

export interface BracketTopologySlot {
  readonly id: string;
  readonly slotNumber: 1 | 2;
  readonly source: BracketSlotSource;
}

export interface BracketTopologyMatch {
  readonly id: BracketMatchId;
  readonly roundId: BracketRoundId;
  readonly roundNumber: number;
  readonly position: number;
  readonly sequence: number;
  readonly slots: readonly [BracketTopologySlot, BracketTopologySlot];
}

export interface BracketTopologyRound {
  readonly id: BracketRoundId;
  readonly roundNumber: number;
  readonly name: string;
  readonly matchCount: number;
  readonly matches: readonly BracketTopologyMatch[];
}

export interface MirroredBracketTopology {
  readonly tournamentId: TournamentId;
  readonly bracketId: BracketId;
  readonly rulesVersion: number;
  readonly placementPolicy: "standard_mirrored_seeded";
  readonly bracketSize: number;
  readonly qualifierCount: number;
  readonly seedCalculationId: string;
  readonly seedCalculationInputDigest: string;
  readonly effectiveSeedSource: EffectiveSeedPlan["source"];
  readonly effectiveSeedOverrideDigest: string | null;
  readonly placementOrder: readonly number[];
  readonly effectiveSeeds: readonly BracketSeedEntry[];
  readonly rounds: readonly BracketTopologyRound[];
  readonly topologyDigest: string;
}

export interface ActiveBracketMatchInput {
  readonly bracketMatchId: BracketMatchId;
  readonly matchId: MatchId;
  readonly instanceNumber: number;
  readonly participantTeamIds: readonly [TournamentTeamId, TournamentTeamId];
  readonly participantsFrozen: boolean;
  readonly status: MatchStatus;
  readonly scoreAvailability: ScoreAvailability;
  readonly winnerTeamId: TournamentTeamId | null;
}

export interface ResolveBracketAdvancementsInput {
  readonly topology: MirroredBracketTopology;
  readonly activeMatches: readonly ActiveBracketMatchInput[];
}

export type BracketResolvedSlotState =
  | {
      readonly type: "team";
      readonly teamId: TournamentTeamId;
      readonly effectiveSeed: number;
    }
  | {
      readonly type: "bye";
      readonly seed: number;
    }
  | {
      readonly type: "empty";
    }
  | {
      readonly type: "tbd";
    };

export interface BracketResolvedSlot extends BracketTopologySlot {
  readonly state: BracketResolvedSlotState;
}

export type BracketMatchResolutionState =
  | "waiting"
  | "ready"
  | "in_progress"
  | "completed"
  | "blocked"
  | "automatic_advance"
  | "empty";

export type BracketMatchBlockingReason =
  | "postponed"
  | "cancelled"
  | "final_unrecorded";

export interface BracketMatchInstanceProjection {
  readonly matchId: MatchId;
  readonly instanceNumber: number;
  readonly participantTeamIds: readonly [TournamentTeamId, TournamentTeamId];
  readonly participantsFrozen: boolean;
  readonly status: MatchStatus;
  readonly scoreAvailability: ScoreAvailability;
}

export interface BracketResolvedMatch
  extends Omit<BracketTopologyMatch, "slots"> {
  readonly slots: readonly [BracketResolvedSlot, BracketResolvedSlot];
  readonly state: BracketMatchResolutionState;
  readonly blockingReason?: BracketMatchBlockingReason;
  readonly winnerTeamId: TournamentTeamId | null;
  readonly matchInstance: BracketMatchInstanceProjection | null;
}

export interface BracketResolvedRound
  extends Omit<BracketTopologyRound, "matches"> {
  readonly matches: readonly BracketResolvedMatch[];
}

export interface BracketResolutionPlan {
  readonly topology: MirroredBracketTopology;
  readonly rounds: readonly BracketResolvedRound[];
  readonly championTeamId: TournamentTeamId | null;
  readonly playableMatches: readonly BracketMatchInstanceProjection[];
  readonly blockedBracketMatchIds: readonly BracketMatchId[];
  readonly resolutionDigest: string;
}

interface AnalyzeBracketCorrectionImpactBaseInput {
  readonly current: BracketResolutionPlan;
  readonly correctedBracketMatchId: BracketMatchId;
  readonly previousWinnerTeamId: TournamentTeamId;
}

export type AnalyzeBracketCorrectionImpactInput =
  AnalyzeBracketCorrectionImpactBaseInput & (
    | {
        readonly correctedWinnerTeamId: TournamentTeamId;
        readonly correctedNoWinnerStatus?: never;
      }
    | {
        readonly correctedWinnerTeamId: null;
        readonly correctedNoWinnerStatus: "cancelled" | "postponed";
      }
  );

export type BracketCorrectionCascadeActionType =
  | "update_unfrozen_match"
  | "clear_unfrozen_match_until_resolved"
  | "replace_started_match"
  | "supersede_started_match_until_resolved"
  | "update_structural_node";

export interface BracketCorrectionReplacementInstance {
  readonly matchId: MatchId;
  readonly instanceNumber: number;
  readonly participantTeamIds:
    | readonly [TournamentTeamId, TournamentTeamId]
    | null;
  readonly createWhenPlayable: boolean;
}

export interface BracketCorrectionCascadeAction {
  readonly bracketMatchId: BracketMatchId;
  readonly changedSlotNumber: 1 | 2;
  readonly action: BracketCorrectionCascadeActionType;
  readonly priorWinnerTeamId: TournamentTeamId | null;
  readonly nextWinnerTeamId: TournamentTeamId | null;
  readonly priorParticipantTeamIds:
    | readonly [TournamentTeamId, TournamentTeamId]
    | null;
  readonly nextParticipantTeamIds:
    | readonly [TournamentTeamId, TournamentTeamId]
    | null;
  readonly preservedMatchId: MatchId | null;
  readonly replacement: BracketCorrectionReplacementInstance | null;
}

export interface BracketCorrectionImpactPlan {
  readonly tournamentId: TournamentId;
  readonly bracketId: BracketId;
  readonly correctedBracketMatchId: BracketMatchId;
  readonly previousWinnerTeamId: TournamentTeamId;
  readonly correctedWinnerTeamId: TournamentTeamId | null;
  readonly correctedNoWinnerStatus: "cancelled" | "postponed" | null;
  readonly winnerChanged: boolean;
  readonly requiresConfirmation: boolean;
  readonly actions: readonly BracketCorrectionCascadeAction[];
  readonly confirmationDigest: string;
}

export interface ConfirmBracketCorrectionImpactInput {
  readonly impact: BracketCorrectionImpactPlan;
  readonly confirmationDigest: string;
}

export interface ConfirmedBracketCorrectionImpact
  extends BracketCorrectionImpactPlan {
  readonly confirmed: true;
}

export interface BracketValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}
