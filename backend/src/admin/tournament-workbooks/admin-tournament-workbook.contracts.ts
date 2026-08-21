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
  currentImpact: AdminWorkbookCurrentScoringImpact | null;
  proposedImpact: AdminWorkbookProposedScoringImpact | null;
  correction: boolean;
  playoffCorrectionImpact: {
    confirmationDigest: string;
    requiresCascade: boolean;
    actionCount: number;
    replacementCount: number;
    actions: readonly {
      bracketMatchId: string;
      action: string;
      previousMatchId: string | null;
      replacementMatchId: string | null;
    }[];
  } | null;
  issues: readonly AdminWorkbookValidationIssue[];
}

export interface AdminWorkbookScoringTotals {
  attempts: number;
  makes: number;
  misses: number;
  shootingPercentage: number | null;
  splashOuts: number;
  guys: number;
  tris: number;
  dis: number;
  voms: number;
  cupsScored: number;
}

export interface AdminWorkbookCurrentScoringImpact {
  revisionId: string;
  teams: readonly {
    sideNumber: 1 | 2;
    teamId: string;
    score: number | null;
    result: "pending" | "win" | "loss" | "tie" | "cancelled" | "forfeited";
  }[];
  winnerTeamId: string | null;
}

export interface AdminWorkbookProposedScoringImpact {
  teams: readonly {
    sideNumber: 1 | 2;
    teamId: string;
    score: number | null;
    result: "pending" | "win" | "loss" | "tie" | "cancelled" | "forfeited";
    totals: AdminWorkbookScoringTotals;
  }[];
  matchTotals: AdminWorkbookScoringTotals;
  winnerTeamId: string | null;
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
  cascadeConfirmationDigests?: unknown;
}

export interface AdminTournamentWorkbookImportResultResponse {
  id: string;
  tournamentId: string;
  status: "applied" | "no_op";
  acceptedCount: number;
  skippedCount: number;
  unchangedCount: number;
  missingNonDestructiveCount: number;
  materializedRevisions: readonly {
    matchId: string;
    candidateId: string;
    revisionId: string;
    matchStatisticRunId: string;
    matchRowVersion: number;
  }[];
  replacementMatchIds: readonly string[];
  tournamentStatisticRunId: string | null;
  tournamentStatisticRunDigest: string | null;
  appliedAt: string;
}

export interface UploadedCanonicalWorkbookFile {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size: number;
}
