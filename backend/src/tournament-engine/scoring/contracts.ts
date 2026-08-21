import {
  MatchRevisionId,
  MatchStatus,
  ScoreAvailability,
  ScoringEventId,
  TournamentId,
  TournamentPlayerId,
  TournamentTeamId
} from "../domain";
import {
  ActivateMatchRevisionInput,
  MatchRevisionEventInput,
  MatchRevisionTeamInput
} from "../persistence/contracts";
import { WorkbookRevisionCandidateInput } from "../workbook/persistence/contracts";

export const RUSKI_CANONICAL_SCORING_RULES_VERSION = 1;

export interface CanonicalRuskiScoringTotals {
  readonly attempts: number;
  readonly makes: number;
  readonly misses: number;
  readonly shootingPercentage: number | null;
  readonly splashOuts: number;
  readonly guys: number;
  readonly tris: number;
  readonly dis: number;
  readonly voms: number;
  readonly cupsScored: number;
}

export interface CanonicalRuskiTeamTotals {
  readonly teamId: TournamentTeamId;
  readonly totals: CanonicalRuskiScoringTotals;
}

export interface CanonicalRuskiPlayerTotals {
  readonly playerId: TournamentPlayerId;
  readonly teamId: TournamentTeamId;
  readonly totals: CanonicalRuskiScoringTotals;
}

export interface CanonicalRuskiEventReduction {
  readonly match: CanonicalRuskiScoringTotals;
  readonly teams: readonly CanonicalRuskiTeamTotals[];
  readonly players: readonly CanonicalRuskiPlayerTotals[];
}

export interface WorkbookCandidateScoringPreview {
  readonly persistedCandidateId: string;
  readonly semanticCandidateId: string;
  readonly tournamentId: TournamentId;
  readonly matchId: WorkbookRevisionCandidateInput["matchId"];
  readonly revisionId: MatchRevisionId;
  readonly status: MatchStatus;
  readonly scoreAvailability: ScoreAvailability;
  readonly teams: readonly MatchRevisionTeamInput[];
  readonly events: readonly MatchRevisionEventInput[];
  readonly winnerTeamId?: TournamentTeamId;
  readonly reduction: CanonicalRuskiEventReduction;
}

export interface MaterializeWorkbookCandidateInput {
  readonly candidate: WorkbookRevisionCandidateInput;
  readonly tournamentId: TournamentId;
  readonly batchId: string;
  readonly observationId: string;
  readonly actorId: string;
  readonly createdAt: string;
  readonly confirmationDigest: string;
  readonly correctionReason?: string;
  readonly activeRevision?: Readonly<{
    id: MatchRevisionId;
    revisionNumber: number;
  }>;
}

export type WorkbookCandidateActivation = Omit<
  ActivateMatchRevisionInput,
  "writerFence" | "audit"
>;

export interface MaterializedWorkbookCandidate {
  readonly activation: WorkbookCandidateActivation;
  readonly preview: WorkbookCandidateScoringPreview;
}

export interface CanonicalScoringValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface CanonicalWorkbookAttemptSource {
  readonly eventId: ScoringEventId;
  readonly sideNumber: 1 | 2;
  readonly worksheetRow: number;
}
