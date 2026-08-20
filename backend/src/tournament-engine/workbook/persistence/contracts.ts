import { createHash } from "node:crypto";

import { CopiedTournamentConfiguration } from "../../configuration";
import {
  MatchStatus,
  ScoreAvailability,
  TournamentId,
  TournamentLifecycle
} from "../../domain";

export type WorkbookId = string;
export type WorkbookSheetId = string;
export type WorkbookImportBatchId = string;
export type WorkbookImportObservationId = string;
export type WorkbookRevisionCandidateId = string;

export interface WorkbookAuditIdentity {
  eventId: string;
  correlationId?: string;
  causationId?: string;
}

export interface WorkbookGenerationSourcePlayerRecord {
  playerId: string;
  rosterMembershipId: string;
  rosterSlot: number;
  displayName: string;
}

export interface WorkbookGenerationSourceTeamRecord {
  teamId: string;
  name: string;
  sequence: number;
  podId: string;
  initialSeed: number;
  players: readonly WorkbookGenerationSourcePlayerRecord[];
}

export interface WorkbookGenerationSourcePodRecord {
  podId: string;
  name: string;
  sequence: number;
}

export interface WorkbookGenerationSourceMatchTeamRecord {
  sideNumber: 1 | 2;
  teamId: string;
  name: string;
  players: readonly WorkbookGenerationSourcePlayerRecord[];
}

export interface WorkbookGenerationSourceMatchRecord {
  matchId: string;
  stage: "pod_play" | "playoffs";
  podId: string | null;
  sequence: number;
  rowVersion: number;
  status: MatchStatus;
  scoreAvailability: ScoreAvailability;
  participantTeamIds: readonly [string, string];
  participantTeams: readonly [
    WorkbookGenerationSourceMatchTeamRecord,
    WorkbookGenerationSourceMatchTeamRecord
  ];
  sequenceInPod: number;
  roundNumber: number;
  gameNumberForPair: number;
  workbookState: {
    rowVersion: number;
    sourceRevisionNumber: number;
    activeCandidateId: string;
    activeFingerprint: string;
    participantDigest: string;
    proposedStatus: MatchStatus;
  } | null;
}

export interface WorkbookGenerationSourceRecord {
  nextGenerationRevision: number;
  tournament: {
    tournamentId: TournamentId;
    publicKey: string;
    year: number;
    name: string;
    lifecycle: TournamentLifecycle;
    rowVersion: number;
    setupPublishedAt: string;
  };
  configuration: CopiedTournamentConfiguration;
  pods: readonly WorkbookGenerationSourcePodRecord[];
  teams: readonly WorkbookGenerationSourceTeamRecord[];
  matches: readonly WorkbookGenerationSourceMatchRecord[];
}

export type GeneratedWorkbookSheetInput =
  | {
      sheetId: WorkbookSheetId;
      sheetOrdinal: number;
      sheetKind: "control";
      sheetName: string;
      baselineFingerprint: null;
    }
  | {
      sheetId: WorkbookSheetId;
      sheetOrdinal: number;
      sheetKind: "blank";
      sheetName: string;
      baselineFingerprint: string;
    }
  | {
      sheetId: WorkbookSheetId;
      sheetOrdinal: number;
      sheetKind: "game";
      sheetName: string;
      matchId: string;
      generatedMatchRowVersion: number;
      participantTeamIds: readonly [string, string];
      participantDigest: string;
      baselineFingerprint: string;
    };

export interface StoreGeneratedWorkbookInput {
  workbookId: WorkbookId;
  tournamentId: TournamentId;
  generationRevision: number;
  workbookSchemaVersion: number;
  generationKind: "setup" | "playoffs_cumulative";
  sourceTournamentRowVersion: number;
  sourceDigest: string;
  artifact: Buffer;
  artifactDigest: string;
  filename: string;
  generatedByAdminId: string;
  generatedAt: string;
  sheets: readonly GeneratedWorkbookSheetInput[];
  audit: WorkbookAuditIdentity;
}

export interface GeneratedWorkbookManifestSheetRecord {
  sheetId: WorkbookSheetId;
  sheetOrdinal: number;
  sheetKind: "control" | "blank" | "game";
  sheetName: string;
  matchId: string | null;
  generatedMatchRowVersion: number | null;
  participantTeamIds: readonly [string, string] | null;
  participantDigest: string | null;
  baselineFingerprint: string | null;
}

export interface GeneratedWorkbookArtifactRecord {
  workbookId: WorkbookId;
  tournamentId: TournamentId;
  generationRevision: number;
  workbookSchemaVersion: number;
  generationKind: "setup" | "playoffs_cumulative";
  sourceTournamentRowVersion: number;
  sourceDigest: string;
  artifactDigest: string;
  artifactSizeBytes: number;
  artifact: Buffer;
  filename: string;
  generatedByAdminId: string;
  generatedAt: string;
  sheets: readonly GeneratedWorkbookManifestSheetRecord[];
}

export interface StoreGeneratedWorkbookResult {
  created: boolean;
  workbook: GeneratedWorkbookArtifactRecord;
}

export type GeneratedWorkbookSummaryRecord = Omit<
  GeneratedWorkbookArtifactRecord,
  "artifact" | "sheets"
> & { sheetCount: number };

export interface WorkbookRevisionCandidatePlayerInput {
  playerId: string;
  rosterMembershipId: string;
  rosterSlot: number;
  displayName: string;
}

export interface WorkbookRevisionCandidateTeamInput {
  sideNumber: 1 | 2;
  teamId: string;
  displayName: string;
  players: readonly WorkbookRevisionCandidatePlayerInput[];
}

export interface WorkbookRevisionCandidateInput {
  candidateId: WorkbookRevisionCandidateId;
  matchId: string;
  previousAppliedCandidateId?: WorkbookRevisionCandidateId;
  sourceRevisionNumber: number;
  fingerprint: string;
  proposedStatus: MatchStatus;
  proposedScoreAvailability: ScoreAvailability;
  reason: "initial" | "workbook_update" | "correction";
  requiresConfirmation: boolean;
  expectedMatchRowVersion: number;
  expectedSourceStateVersion: number;
  envelopeSchemaVersion: number;
  envelope: Readonly<Record<string, unknown>>;
  envelopeDigest: string;
  participantDigest: string;
  teams: readonly WorkbookRevisionCandidateTeamInput[];
}

export interface WorkbookObservationValidationIssue {
  code: string;
  severity: "warning" | "error";
  message: string;
  path?: string;
}

export type WorkbookImportObservationInput =
  | {
      observationId: WorkbookImportObservationId;
      observationKind: "present";
      sheetOrdinal: number;
      workbookSheetId?: WorkbookSheetId;
      matchId?: string;
      assignmentSource:
        | "stable_metadata"
        | "explicit_blank"
        | "exact_identity_fallback"
        | "none";
      disposition:
        | "proposed"
        | "unchanged"
        | "invalid"
        | "ambiguous";
      fingerprint?: string;
      baseMatchRowVersion?: number;
      baseSourceStateVersion: number;
      sourceEnvelopeSchemaVersion: number;
      sourceEnvelope: Readonly<Record<string, unknown>>;
      sourceEnvelopeDigest: string;
      validationIssues: readonly WorkbookObservationValidationIssue[];
      candidate?: WorkbookRevisionCandidateInput;
    }
  | {
      observationId: WorkbookImportObservationId;
      observationKind: "missing";
      workbookSheetId: WorkbookSheetId;
      matchId: string;
      assignmentSource: "none";
      disposition: "missing";
      baseMatchRowVersion: number;
      baseSourceStateVersion: number;
      validationIssues: readonly WorkbookObservationValidationIssue[];
    };

export interface CreateWorkbookImportPreviewInput {
  batchId: WorkbookImportBatchId;
  tournamentId: TournamentId;
  workbookId: WorkbookId;
  workbookSchemaVersion: number;
  sourceWorkbookDigest: string;
  sourceSizeBytes: number;
  baseTournamentRowVersion: number;
  previewDigest: string;
  status: "preview_ready" | "preview_rejected";
  receivedByAdminId: string;
  receivedAt: string;
  previewedAt: string;
  observations: readonly WorkbookImportObservationInput[];
  audit: WorkbookAuditIdentity;
}

export interface ReviseWorkbookImportPreviewInput {
  batchId: WorkbookImportBatchId;
  tournamentId: TournamentId;
  supersedesBatchId: WorkbookImportBatchId;
  previewDigest: string;
  status: "preview_ready" | "preview_rejected";
  revisedByAdminId: string;
  previewedAt: string;
  observations: readonly WorkbookImportObservationInput[];
  audit: WorkbookAuditIdentity;
}

export interface WorkbookImportObservationRecord {
  observationId: WorkbookImportObservationId;
  observationKind: "present" | "missing";
  sheetOrdinal: number | null;
  workbookSheetId: WorkbookSheetId | null;
  matchId: string | null;
  assignmentSource:
    | "stable_metadata"
    | "explicit_blank"
    | "exact_identity_fallback"
    | "none";
  disposition: "proposed" | "unchanged" | "missing" | "invalid" | "ambiguous";
  fingerprint: string | null;
  baseMatchRowVersion: number | null;
  baseSourceStateVersion: number;
  sourceEnvelopeSchemaVersion: number | null;
  sourceEnvelopeDigest: string | null;
  sourceEnvelope: Readonly<Record<string, unknown>> | null;
  validationIssues: readonly WorkbookObservationValidationIssue[];
  candidate: WorkbookRevisionCandidateInput | null;
}

export interface WorkbookImportPreviewRecord {
  batchId: WorkbookImportBatchId;
  tournamentId: TournamentId;
  workbookId: WorkbookId;
  supersedesBatchId: WorkbookImportBatchId | null;
  workbookSchemaVersion: number;
  sourceWorkbookDigest: string;
  sourceSizeBytes: number;
  baseTournamentRowVersion: number;
  previewDigest: string;
  status:
    | "preview_ready"
    | "preview_rejected"
    | "applied"
    | "no_op"
    | "expired"
    | "superseded";
  receivedByAdminId: string;
  receivedAt: string;
  previewedAt: string;
  previewExpiresAt: string;
  confirmedByAdminId: string | null;
  confirmedAt: string | null;
  completedAt: string | null;
  counts: {
    recognized: number;
    proposed: number;
    unchanged: number;
    missing: number;
    invalid: number;
  };
  observations: readonly WorkbookImportObservationRecord[];
}

export interface ConfirmWorkbookImportInput {
  tournamentId: TournamentId;
  batchId: WorkbookImportBatchId;
  previewDigest: string;
  acceptedObservationIds: readonly WorkbookImportObservationId[];
  skippedObservationIds: readonly WorkbookImportObservationId[];
  correctionReasons?: Readonly<Record<WorkbookImportObservationId, string>>;
  confirmedByAdminId: string;
  audit: WorkbookAuditIdentity;
}

export interface WorkbookImportConfirmationResult {
  batchId: WorkbookImportBatchId;
  tournamentId: TournamentId;
  status: "applied" | "no_op";
  appliedMatchIds: readonly string[];
  skippedMatchIds: readonly string[];
  unchangedMatchIds: readonly string[];
  missingMatchIds: readonly string[];
  completedAt: string;
}

export function digestWorkbookValue(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function digestWorkbookParticipants(
  teams: readonly WorkbookRevisionCandidateTeamInput[]
): string {
  return digestWorkbookValue(teams
    .map((team) => ({
      sideNumber: team.sideNumber,
      teamId: team.teamId,
      players: team.players.map((player) => ({
        playerId: player.playerId,
        rosterMembershipId: player.rosterMembershipId,
        rosterSlot: player.rosterSlot
      })).sort((first, second) =>
        first.rosterSlot - second.rosterSlot ||
        first.playerId.localeCompare(second.playerId)
      )
    }))
    .sort((first, second) => first.sideNumber - second.sideNumber));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Workbook values must contain only finite numbers.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, item]) => {
        if (item === undefined) {
          throw new TypeError("Workbook values cannot contain undefined fields.");
        }
        return [key, canonicalize(item)];
      }));
  }
  throw new TypeError("Workbook values must be JSON-serializable.");
}
