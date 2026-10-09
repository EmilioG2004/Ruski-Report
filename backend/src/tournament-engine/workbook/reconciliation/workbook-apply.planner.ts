import { canonicalSha256 } from "../canonical-json";
import { WorkbookApplyPlanningError } from "./errors";
import { createWorkbookParticipantDigest } from "./semantic-fingerprint";
import {
  CanonicalMatchReconciliationScope,
  PlanWorkbookImportApplyInput,
  PlannedWorkbookCandidate,
  WorkbookImportApplyPlan,
  WorkbookIssue,
  WorkbookSheetObservation
} from "./types";

export function planWorkbookImportApply(
  input: PlanWorkbookImportApplyInput
): WorkbookImportApplyPlan {
  const issues: WorkbookIssue[] = [];
  if (!input.preview.applicable) {
    issues.push(problem(
      "PREVIEW_NOT_APPLICABLE",
      "Workbook preview contains global validation errors."
    ));
  }
  if (input.expectedPreviewDigest !== input.preview.previewDigest) {
    issues.push(problem(
      "PREVIEW_DIGEST_MISMATCH",
      "Workbook preview digest is stale or invalid."
    ));
  }
  const observations = new Map(
    input.preview.observations.map((observation) => [observation.id, observation])
  );
  const proposed = input.preview.observations.filter(hasCandidate);
  const selectedIds = input.selectedObservationIds === undefined
    ? proposed.map((observation) => observation.id)
    : [...input.selectedObservationIds];
  if (new Set(selectedIds).size !== selectedIds.length) {
    issues.push(problem(
      "DUPLICATE_APPLY_SELECTION",
      "Workbook apply selection contains a duplicate observation."
    ));
  }
  const correctionReasons = new Map(
    (input.correctionReasons ?? []).map((entry) => [entry.observationId, entry.reason.trim()])
  );
  const currentMatches = new Map(input.currentMatches.map((match) => [match.matchId, match]));
  const selected: PlannedWorkbookCandidate[] = [];
  const selectedMatchIds = new Set<string>();

  for (const observationId of selectedIds) {
    const selectedObservation = observations.get(observationId);
    if (selectedObservation === undefined || !hasCandidate(selectedObservation)) {
      issues.push(problem(
        "APPLY_SELECTION_NOT_PROPOSED",
        "Workbook apply may select only valid proposed observations."
      ));
      continue;
    }
    const candidate = selectedObservation.candidate;
    if (selectedMatchIds.has(candidate.matchId)) {
      issues.push(problem(
        "APPLY_SELECTION_DUPLICATES_MATCH",
        "Workbook apply may select only one candidate per match."
      ));
      continue;
    }
    selectedMatchIds.add(candidate.matchId);
    const current = currentMatches.get(candidate.matchId);
    validateFreshness(candidate, current, issues);
    const reason = correctionReasons.get(observationId);
    if (
      candidate.requiresCorrectionReason &&
      (reason === undefined || reason.length < 3 || reason.length > 500)
    ) {
      issues.push(problem(
        "CORRECTION_REASON_REQUIRED",
        "Final-result correction requires a reason between 3 and 500 characters."
      ));
    }
    selected.push({
      observationId,
      candidate,
      correctionReason: reason
    });
  }

  if (issues.length > 0) {
    throw new WorkbookApplyPlanningError(
      "Workbook apply could not be planned.",
      issues
    );
  }
  selected.sort((left, right) => left.candidate.matchId.localeCompare(right.candidate.matchId));
  const selectedIdSet = new Set(selected.map((item) => item.observationId));
  const skippedObservationIds = proposed
    .filter((observation) => !selectedIdSet.has(observation.id))
    .map((observation) => observation.id);
  const confirmationDigest = canonicalSha256({
    contract: "canonical-workbook-apply-v1",
    previewDigest: input.preview.previewDigest,
    selected: selected.map((item) => ({
      observationId: item.observationId,
      candidateId: item.candidate.id,
      correctionReason: item.correctionReason ?? null
    }))
  });
  return {
    previewDigest: input.preview.previewDigest,
    confirmationDigest,
    selected,
    skippedObservationIds,
    noOp: selected.length === 0
  };
}

function validateFreshness(
  candidate: PlannedWorkbookCandidate["candidate"],
  current: CanonicalMatchReconciliationScope | undefined,
  issues: WorkbookIssue[]
): void {
  if (current === undefined) {
    issues.push(problem(
      "MATCH_NO_LONGER_AVAILABLE",
      "Proposed match is no longer available in the tournament."
    ));
    return;
  }
  if (current.matchRowVersion !== candidate.expectedMatchRowVersion) {
    issues.push(problem(
      "MATCH_CHANGED_AFTER_PREVIEW",
      "Match changed after workbook preview."
    ));
  }
  const source = current.sourceState;
  const expectedSource = candidate.expectedSourceStateRowVersion;
  if (
    (expectedSource === undefined && source !== undefined) ||
    (expectedSource !== undefined && source?.rowVersion !== expectedSource) ||
    candidate.previousCandidateId !== source?.candidateId ||
    candidate.sourceRevisionNumber !== (source?.sourceRevisionNumber ?? 0) + 1
  ) {
    issues.push(problem(
      "WORKBOOK_SOURCE_CHANGED_AFTER_PREVIEW",
      "Accepted workbook source changed after preview."
    ));
  }
  const currentParticipantDigest = createWorkbookParticipantDigest(current.participants);
  if (
    candidate.participantDigest !== currentParticipantDigest ||
    (source !== undefined && candidate.participantDigest !== source.participantDigest)
  ) {
    issues.push(problem(
      "MATCH_PARTICIPANTS_CHANGED_AFTER_PREVIEW",
      "Match participant identities changed after preview."
    ));
  }
}

function hasCandidate(
  observation: WorkbookSheetObservation
): observation is WorkbookSheetObservation & {
  candidate: NonNullable<WorkbookSheetObservation["candidate"]>;
} {
  return observation.decision === "proposed" && observation.candidate !== undefined;
}

function problem(code: string, message: string): WorkbookIssue {
  return { code, severity: "error", message };
}
