import {
  MatchId,
  MatchStatus,
  PodId,
  RosterMembershipId,
  ScoreAvailability,
  TournamentId,
  TournamentPlayerId,
  TournamentStage,
  TournamentTeamId
} from "../../domain";
import { CanonicalScorecardStatus } from "../schema";

export type WorkbookIssueSeverity = "warning" | "error";

export interface WorkbookIssue {
  readonly code: string;
  readonly severity: WorkbookIssueSeverity;
  readonly message: string;
  readonly path?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CanonicalXlsxEntry {
  readonly name: string;
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
  readonly compressionMethod: number;
}

export interface CanonicalXlsxPreflightResult {
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
  readonly entries: readonly CanonicalXlsxEntry[];
}

export interface CanonicalWorkbookGenerationScope {
  readonly generationId: string;
  readonly generationRevision: number;
  readonly generationSourceDigest: string;
}

export interface WorkbookParticipantIdentity {
  readonly sideNumber: 1 | 2;
  readonly teamId: TournamentTeamId;
  readonly playerId: TournamentPlayerId;
  readonly rosterMembershipId: RosterMembershipId;
  readonly rosterSlot: number;
  readonly displayName: string;
}

export interface CanonicalMatchSourceState {
  readonly fingerprint: string;
  readonly candidateId: string;
  readonly sourceRevisionNumber: number;
  readonly proposedStatus: MatchStatus;
  readonly participantDigest: string;
  readonly rowVersion: number;
}

export interface CanonicalMatchReconciliationScope {
  readonly matchId: MatchId;
  readonly matchRowVersion: number;
  readonly activeRevisionId?: string;
  readonly canonicalStatus: MatchStatus;
  readonly stage: TournamentStage;
  readonly podId?: PodId;
  readonly bracketMatchId?: string;
  readonly teamIds: readonly [TournamentTeamId, TournamentTeamId];
  readonly participants: readonly WorkbookParticipantIdentity[];
  readonly sourceState?: CanonicalMatchSourceState;
}

export interface CanonicalWorkbookScope {
  readonly tournamentId: TournamentId;
  readonly generation: CanonicalWorkbookGenerationScope;
  readonly manifest: readonly ParsedCanonicalWorkbookManifestEntry[];
  readonly matches: readonly CanonicalMatchReconciliationScope[];
}

export interface ExplicitBlankAssignment {
  readonly worksheetIndex: number;
  readonly matchId: MatchId;
}

export interface ParseCanonicalWorkbookInput {
  readonly buffer: Buffer;
  readonly scope: CanonicalWorkbookScope;
  readonly assignments?: readonly ExplicitBlankAssignment[];
}

export interface ParsedCanonicalWorkbookControl {
  readonly magic: string;
  readonly workbookSchemaVersion: number;
  readonly scorecardLayoutVersion: number;
  readonly tournamentId: TournamentId;
  readonly generationId: string;
  readonly generationRevision: number;
  readonly generationSourceDigest: string;
  readonly generatedAt: string;
}

export interface ParsedCanonicalWorkbookManifestEntry {
  readonly sheetId: string;
  readonly sheetName: string;
  readonly sheetKind: "blank" | "game";
  readonly matchId?: MatchId;
  readonly stage?: TournamentStage;
  readonly podId?: PodId;
  readonly bracketMatchId?: string;
  readonly teamIds?: readonly [TournamentTeamId, TournamentTeamId];
  readonly baselineFingerprint: string;
}

export interface ParsedWorkbookShotRow {
  readonly sideNumber: 1 | 2;
  readonly worksheetRow: number;
  readonly shotNumber: number | null;
  readonly observedShooter: string | null;
  readonly markers: Readonly<{
    miss: boolean;
    make: boolean;
    splashOut: boolean;
    guy: boolean;
    tri: boolean;
    di: boolean;
    vom: boolean;
  }>;
}

export type WorkbookFormulaSummaryMetric =
  | "misses"
  | "makes"
  | "splashOuts"
  | "guys"
  | "tris"
  | "dis"
  | "voms"
  | "shootingPercentage";

export interface WorkbookFormulaSummaryObservation {
  readonly sideNumber: 1 | 2;
  readonly subjectType: "player" | "team";
  readonly rosterSlot?: number;
  readonly metric: WorkbookFormulaSummaryMetric;
  readonly formulaState: "exact" | "changed" | "missing";
  readonly cachedValue: number | null;
}

export interface NormalizedWorkbookShotRow {
  readonly sideNumber: 1 | 2;
  readonly worksheetRow: number;
  readonly shotNumber: number | null;
  readonly teamId: TournamentTeamId;
  readonly playerId: TournamentPlayerId;
  readonly rosterMembershipId: RosterMembershipId;
  readonly rosterSlot: number;
  readonly markers: ParsedWorkbookShotRow["markers"];
}

export interface ParsedCanonicalScorecardSheet {
  readonly worksheetIndex: number;
  readonly worksheetName: string;
  readonly sheetId: string;
  readonly sheetKind: "blank" | "game";
  readonly status: CanonicalScorecardStatus;
  readonly playersPerTeam: number;
  readonly matchId?: MatchId;
  readonly stage?: TournamentStage;
  readonly podId?: PodId;
  readonly bracketMatchId?: string;
  readonly teamIds?: readonly [TournamentTeamId, TournamentTeamId];
  readonly participants: readonly WorkbookParticipantIdentity[];
  readonly rows: readonly ParsedWorkbookShotRow[];
  readonly formulaSummaryObservations:
    readonly WorkbookFormulaSummaryObservation[];
  readonly issues: readonly WorkbookIssue[];
}

export interface ParsedCanonicalWorkbook {
  readonly checksum: string;
  readonly control?: ParsedCanonicalWorkbookControl;
  readonly manifest: readonly ParsedCanonicalWorkbookManifestEntry[];
  readonly scorecards: readonly ParsedCanonicalScorecardSheet[];
  readonly ignoredWorksheetNames: readonly string[];
  readonly issues: readonly WorkbookIssue[];
}

export type WorkbookSheetObservationDecision =
  | "unchanged"
  | "proposed"
  | "invalid"
  | "unresolved"
  | "missing_non_destructive";

export type WorkbookMatchBinding =
  | "embedded_match_id"
  | "explicit_blank_assignment";

export interface WorkbookRevisionParticipant {
  readonly sideNumber: 1 | 2;
  readonly teamId: TournamentTeamId;
  readonly playerId: TournamentPlayerId;
  readonly rosterMembershipId: RosterMembershipId;
  readonly rosterSlot: number;
  readonly displayNameAtImport: string;
}

export interface WorkbookMatchRevisionCandidate {
  readonly id: string;
  readonly tournamentId: TournamentId;
  readonly matchId: MatchId;
  readonly sourceRevisionNumber: number;
  readonly previousCandidateId?: string;
  readonly fingerprint: string;
  readonly proposedStatus: MatchStatus;
  readonly proposedScoreAvailability: ScoreAvailability;
  readonly reason: "initial" | "workbook_update" | "correction";
  readonly requiresConfirmation: boolean;
  readonly requiresCorrectionReason: boolean;
  readonly expectedMatchRowVersion: number;
  readonly expectedSourceStateRowVersion?: number;
  readonly participantDigest: string;
  readonly participants: readonly WorkbookRevisionParticipant[];
  readonly rawRows: readonly NormalizedWorkbookShotRow[];
  readonly formulaSummaryObservations?:
    readonly WorkbookFormulaSummaryObservation[];
}

export interface WorkbookSheetObservation {
  readonly id: string;
  readonly worksheetIndex?: number;
  readonly worksheetName?: string;
  readonly sheetId?: string;
  readonly matchId?: MatchId;
  readonly binding?: WorkbookMatchBinding;
  readonly fingerprint?: string;
  readonly decision: WorkbookSheetObservationDecision;
  readonly issues: readonly WorkbookIssue[];
  readonly formulaSummaryObservations?:
    readonly WorkbookFormulaSummaryObservation[];
  readonly candidate?: WorkbookMatchRevisionCandidate;
}

export interface WorkbookReconciliationPreview {
  readonly checksum: string;
  readonly previewDigest: string;
  readonly tournamentId: TournamentId;
  readonly generation: CanonicalWorkbookGenerationScope;
  readonly observations: readonly WorkbookSheetObservation[];
  readonly issues: readonly WorkbookIssue[];
  readonly applicable: boolean;
}

export interface CreateWorkbookReconciliationPreviewInput {
  readonly parsed: ParsedCanonicalWorkbook;
  readonly scope: CanonicalWorkbookScope;
  readonly assignments?: readonly ExplicitBlankAssignment[];
}

export interface WorkbookCorrectionReason {
  readonly observationId: string;
  readonly reason: string;
}

export interface PlanWorkbookImportApplyInput {
  readonly preview: WorkbookReconciliationPreview;
  readonly expectedPreviewDigest: string;
  readonly selectedObservationIds?: readonly string[];
  readonly correctionReasons?: readonly WorkbookCorrectionReason[];
  readonly currentMatches: readonly CanonicalMatchReconciliationScope[];
}

export interface PlannedWorkbookCandidate {
  readonly observationId: string;
  readonly candidate: WorkbookMatchRevisionCandidate;
  readonly correctionReason?: string;
}

export interface WorkbookImportApplyPlan {
  readonly previewDigest: string;
  readonly confirmationDigest: string;
  readonly selected: readonly PlannedWorkbookCandidate[];
  readonly skippedObservationIds: readonly string[];
  readonly noOp: boolean;
}
