export interface GenerateAdminTournamentWorkbookRequest {
  expectedTournamentRowVersion?: unknown;
}

export interface AdminTournamentWorkbookGenerationResponse {
  id: string;
  tournamentId: string;
  revision: number;
  schemaVersion: number;
  sourceDigest: string;
  artifactSha256: string;
  sizeBytes: number;
  generatedAt: string;
  filename: string;
  downloadUrl: string;
}

export interface AdminWorkbookValidationIssue {
  code: string;
  message: string;
  severity: "warning" | "error";
  observationId?: string;
}

export interface AdminWorkbookImportObservationResponse {
  id: string;
  ordinal: number;
  label: string;
  classification: "unchanged" | "proposed" | "invalid" | "unresolved";
  matchId: string | null;
  matchLabel: string | null;
  proposedStatus: "scheduled" | "in_progress" | "final" | null;
  proposedScoreAvailability:
    | "not_started"
    | "partial"
    | "complete"
    | "unrecorded"
    | null;
  correction: boolean;
  issues: readonly AdminWorkbookValidationIssue[];
}

export interface AdminWorkbookAssignableMatchResponse {
  id: string;
  label: string;
}

export interface AdminTournamentWorkbookImportPreviewResponse {
  id: string;
  tournamentId: string;
  sourceGenerationId: string;
  status:
    | "preview_ready"
    | "preview_rejected"
    | "assignment_required"
    | "no_op"
    | "applied"
    | "expired";
  previewDigest: string | null;
  expiresAt: string;
  counts: {
    unchanged: number;
    proposed: number;
    invalid: number;
    unresolved: number;
    missingNonDestructive: number;
  };
  observations: readonly AdminWorkbookImportObservationResponse[];
  assignableMatches: readonly AdminWorkbookAssignableMatchResponse[];
  issues: readonly AdminWorkbookValidationIssue[];
}

export interface AssignAdminWorkbookSheetsRequest {
  expectedPreviewDigest?: unknown;
  assignments?: unknown;
}

export interface ApplyAdminWorkbookImportRequest {
  previewDigest?: unknown;
  acceptedObservationIds?: unknown;
  skippedObservationIds?: unknown;
  correctionReasons?: unknown;
}

export interface AdminTournamentWorkbookImportResultResponse {
  id: string;
  tournamentId: string;
  status: "applied" | "no_op";
  acceptedCount: number;
  skippedCount: number;
  unchangedCount: number;
  missingNonDestructiveCount: number;
  appliedAt: string;
}

export interface UploadedCanonicalWorkbookFile {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size: number;
}
