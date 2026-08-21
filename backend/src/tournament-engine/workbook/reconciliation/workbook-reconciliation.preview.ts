import { canonicalSha256 } from "../canonical-json";
import { createUuidV5 } from "../../scheduling/uuid-v5";
import {
  CanonicalMatchReconciliationScope,
  CreateWorkbookReconciliationPreviewInput,
  ExplicitBlankAssignment,
  ParsedCanonicalScorecardSheet,
  ParsedCanonicalWorkbookManifestEntry,
  WorkbookIssue,
  WorkbookMatchBinding,
  WorkbookMatchRevisionCandidate,
  NormalizedWorkbookShotRow,
  WorkbookReconciliationPreview,
  WorkbookSheetObservation
} from "./types";
import {
  createSemanticSheetFingerprint,
  createWorkbookParticipantDigest
} from "./semantic-fingerprint";

interface BoundSheet {
  readonly sheet: ParsedCanonicalScorecardSheet;
  readonly match: CanonicalMatchReconciliationScope;
  readonly manifest: ParsedCanonicalWorkbookManifestEntry;
  readonly binding: WorkbookMatchBinding;
}

export function createWorkbookReconciliationPreview(
  input: CreateWorkbookReconciliationPreviewInput
): WorkbookReconciliationPreview {
  const globalIssues = [...input.parsed.issues];
  validateControlScope(input, globalIssues);
  const assignments = assignmentMap(input.assignments ?? [], globalIssues);
  const matches = new Map(input.scope.matches.map((match) => [match.matchId, match]));
  const manifestBySheetId = new Map(input.scope.manifest.map((entry) => [entry.sheetId, entry]));
  const manifestByMatchId = new Map(
    input.scope.manifest.flatMap((entry) => entry.matchId === undefined ? [] : [[entry.matchId, entry]])
  );
  const observedManifestSheetIds = new Set<string>();
  const boundMatchIds = new Set<string>();
  const preliminary: WorkbookSheetObservation[] = [];
  const unresolvedBlanks: ParsedCanonicalScorecardSheet[] = [];

  for (const sheet of input.parsed.scorecards) {
    if (manifestBySheetId.has(sheet.sheetId)) {
      observedManifestSheetIds.add(sheet.sheetId);
    }
    const assignment = assignments.get(sheet.worksheetIndex);
    if (sheet.sheetKind === "blank" && assignment === undefined) {
      unresolvedBlanks.push(sheet);
      continue;
    }
    const bound = bindSheet(
      sheet,
      assignment,
      matches,
      manifestBySheetId,
      manifestByMatchId
    );
    if (bound.value === undefined) {
      preliminary.push(observation(sheet, "invalid", bound.issues, {
        matchId: sheet.matchId
      }));
      continue;
    }
    observedManifestSheetIds.add(bound.value.manifest.sheetId);
    boundMatchIds.add(bound.value.match.matchId);
    preliminary.push(reconcileBoundSheet(bound.value, input.scope.tournamentId));
  }

  preliminary.push(...observeUnassignedBlanks(unresolvedBlanks, input.scope.manifest));
  const observations = rejectDuplicateBindings(preliminary);
  const finalBoundMatchIds = new Set(
    observations.flatMap((item) =>
      item.matchId !== undefined && item.decision !== "invalid" ? [item.matchId] : []
    )
  );
  const missing = input.scope.manifest
    .filter((entry) =>
      entry.sheetKind === "game" &&
      entry.matchId !== undefined &&
      !observedManifestSheetIds.has(entry.sheetId) &&
      !boundMatchIds.has(entry.matchId) &&
      !finalBoundMatchIds.has(entry.matchId)
    )
    .map(missingObservation);
  const allObservations = [...observations, ...missing].sort(compareObservation);
  const previewDigest = canonicalSha256({
    contract: "canonical-workbook-preview-v1",
    checksum: input.parsed.checksum,
    tournamentId: input.scope.tournamentId,
    generation: input.scope.generation,
    observations: allObservations
  });
  return {
    checksum: input.parsed.checksum,
    previewDigest,
    tournamentId: input.scope.tournamentId,
    generation: input.scope.generation,
    observations: allObservations,
    issues: globalIssues,
    applicable: !globalIssues.some((issue) => issue.severity === "error")
  };
}

function validateControlScope(
  input: CreateWorkbookReconciliationPreviewInput,
  issues: WorkbookIssue[]
): void {
  const control = input.parsed.control;
  if (control === undefined) {
    issues.push(problem(
      "WORKBOOK_CONTROL_UNAVAILABLE",
      "Canonical workbook identity could not be established."
    ));
    return;
  }
  if (
    control.tournamentId !== input.scope.tournamentId ||
    control.generationId !== input.scope.generation.generationId ||
    control.generationRevision !== input.scope.generation.generationRevision ||
    control.generationSourceDigest !== input.scope.generation.generationSourceDigest
  ) {
    issues.push(problem(
      "WORKBOOK_SCOPE_MISMATCH",
      "Workbook does not match the trusted tournament generation."
    ));
  }
  if (manifestDigest(input.parsed.manifest) !== manifestDigest(input.scope.manifest)) {
    issues.push(problem(
      "WORKBOOK_MANIFEST_SCOPE_MISMATCH",
      "Workbook manifest does not match the trusted generated artifact."
    ));
  }
}

function manifestDigest(
  manifest: readonly ParsedCanonicalWorkbookManifestEntry[]
): string {
  return canonicalSha256(
    [...manifest]
      .sort((left, right) => left.sheetId.localeCompare(right.sheetId))
      .map((entry) => ({
        sheetId: entry.sheetId,
        sheetKind: entry.sheetKind,
        matchId: entry.matchId ?? null,
        stage: entry.stage ?? null,
        podId: entry.podId ?? null,
        bracketMatchId: entry.bracketMatchId ?? null,
        teamIds: entry.teamIds ?? [],
        baselineFingerprint: entry.baselineFingerprint
      }))
  );
}

function assignmentMap(
  assignments: readonly ExplicitBlankAssignment[],
  issues: WorkbookIssue[]
): Map<number, ExplicitBlankAssignment> {
  const result = new Map<number, ExplicitBlankAssignment>();
  for (const assignment of assignments) {
    if (result.has(assignment.worksheetIndex)) {
      issues.push(problem(
        "DUPLICATE_BLANK_ASSIGNMENT",
        "A workbook sheet may have only one explicit match assignment."
      ));
    } else {
      result.set(assignment.worksheetIndex, assignment);
    }
  }
  return result;
}

function bindSheet(
  sheet: ParsedCanonicalScorecardSheet,
  assignment: ExplicitBlankAssignment | undefined,
  matches: ReadonlyMap<string, CanonicalMatchReconciliationScope>,
  manifestBySheetId: ReadonlyMap<string, ParsedCanonicalWorkbookManifestEntry>,
  manifestByMatchId: ReadonlyMap<string, ParsedCanonicalWorkbookManifestEntry>
): { value?: BoundSheet; issues: WorkbookIssue[] } {
  const issues = [...sheet.issues];
  if (sheet.sheetKind === "game" && assignment !== undefined) {
    issues.push(problem(
      "EXPLICIT_ASSIGNMENT_CONFLICTS_WITH_EMBEDDED_ID",
      "Explicit assignment cannot override a generated game sheet identity."
    ));
    return { issues };
  }
  const matchId = assignment?.matchId ?? sheet.matchId;
  if (matchId === undefined) {
    issues.push(problem(
      "COPIED_BLANK_ASSIGNMENT_REQUIRED",
      "Copied blank scorecard requires an explicit stable match assignment."
    ));
    return { issues };
  }
  const match = matches.get(matchId);
  if (match === undefined) {
    issues.push(problem(
      "MATCH_ID_OUT_OF_SCOPE",
      "Scorecard match identity does not belong to this tournament generation."
    ));
    return { issues };
  }
  const manifest = assignment === undefined
    ? manifestBySheetId.get(sheet.sheetId)
    : manifestByMatchId.get(matchId);
  if (manifest === undefined || manifest.matchId !== matchId) {
    issues.push(problem(
      "SCORECARD_MANIFEST_MISMATCH",
      "Scorecard stable identity is absent from the trusted generation manifest."
    ));
    return { issues };
  }
  if (assignment === undefined) {
    validateEmbeddedBinding(sheet, match, manifest, issues);
  } else if (sheet.sheetKind !== "blank") {
    issues.push(problem(
      "EXPLICIT_ASSIGNMENT_REQUIRES_BLANK",
      "Only a canonical copied blank may be explicitly assigned."
    ));
  }
  validatePlayerCount(sheet, match, issues);
  return issues.some((issue) => issue.severity === "error")
    ? { issues }
    : {
      issues,
      value: {
        sheet,
        match,
        manifest,
        binding: assignment === undefined
          ? "embedded_match_id"
          : "explicit_blank_assignment"
      }
    };
}

function validatePlayerCount(
  sheet: ParsedCanonicalScorecardSheet,
  match: CanonicalMatchReconciliationScope,
  issues: WorkbookIssue[]
): void {
  const counts = [1, 2].map((sideNumber) =>
    match.participants.filter((participant) => participant.sideNumber === sideNumber).length
  );
  const slotsAreContiguous = [1, 2].every((sideNumber) => {
    const slots = match.participants
      .filter((participant) => participant.sideNumber === sideNumber)
      .map((participant) => participant.rosterSlot)
      .sort((left, right) => left - right);
    return slots.every((slot, index) => slot === index + 1);
  });
  if (
    counts[0] !== sheet.playersPerTeam ||
    counts[1] !== sheet.playersPerTeam ||
    !slotsAreContiguous
  ) {
    issues.push(problem(
      "SCORECARD_PLAYER_COUNT_CONFLICT",
      "Scorecard player count does not match the exact canonical match roster."
    ));
  }
}

function validateEmbeddedBinding(
  sheet: ParsedCanonicalScorecardSheet,
  match: CanonicalMatchReconciliationScope,
  manifest: ParsedCanonicalWorkbookManifestEntry,
  issues: WorkbookIssue[]
): void {
  const identitiesMatch =
    sheet.sheetKind === "game" &&
    sheet.matchId === match.matchId &&
    sheet.stage === match.stage &&
    sheet.podId === match.podId &&
    sheet.bracketMatchId === match.bracketMatchId &&
    equalPair(sheet.teamIds, match.teamIds) &&
    manifest.stage === match.stage &&
    manifest.podId === match.podId &&
    manifest.bracketMatchId === match.bracketMatchId &&
    equalPair(manifest.teamIds, match.teamIds);
  if (!identitiesMatch) {
    issues.push(problem(
      "SCORECARD_STABLE_METADATA_CONFLICT",
      "Scorecard match, stage, or team metadata conflicts with canonical state."
    ));
  }
  const parsedParticipantDigest = createWorkbookParticipantDigest(sheet.participants);
  const expectedParticipantDigest = createWorkbookParticipantDigest(match.participants);
  if (
    sheet.participants.length !== match.participants.length ||
    parsedParticipantDigest !== expectedParticipantDigest ||
    (match.sourceState !== undefined &&
      match.sourceState.participantDigest !== expectedParticipantDigest)
  ) {
    issues.push(problem(
      "SCORECARD_PARTICIPANT_FREEZE_CONFLICT",
      "Scorecard participant identities conflict with the frozen match roster."
    ));
  }
}

function reconcileBoundSheet(
  bound: BoundSheet,
  tournamentId: WorkbookMatchRevisionCandidate["tournamentId"]
): WorkbookSheetObservation {
  const { sheet, match, manifest, binding } = bound;
  const issues = [...sheet.issues];
  const normalizedRows = bindStableRowIdentity(sheet, match, issues);
  const fingerprint = createSemanticSheetFingerprint({
    tournamentId,
    matchId: match.matchId,
    stage: match.stage,
    podId: match.podId,
    bracketMatchId: match.bracketMatchId,
    teamIds: match.teamIds,
    participants: match.participants,
    status: sheet.status,
    rows: normalizedRows
  });
  const priorFingerprint = match.sourceState?.fingerprint ?? manifest.baselineFingerprint;
  const observationBase = {
    worksheetIndex: sheet.worksheetIndex,
    worksheetName: sheet.worksheetName,
    sheetId: sheet.sheetId,
    matchId: match.matchId,
    binding,
    fingerprint
  };
  if (issues.some((issue) => issue.severity === "error")) {
    return observation(sheet, "invalid", issues, observationBase);
  }
  if (fingerprint === priorFingerprint) {
    return observation(sheet, "unchanged", issues, observationBase);
  }
  if (isStatusRegression(sheet.status, match)) {
    return observation(sheet, "invalid", [
      ...issues,
      problem(
        "SCORECARD_STATUS_REGRESSION",
        "Excel import cannot reopen or unschedule an accepted match."
      )
    ], observationBase);
  }
  if (sheet.status === "SCHEDULED") {
    return observation(sheet, "unchanged", [
      ...issues,
      warning(
        "SCHEDULED_SOURCE_DIFFERENCE_IGNORED",
        "Non-scoring changes to a scheduled scorecard do not create a revision candidate."
      )
    ], observationBase);
  }
  const correction =
    match.canonicalStatus === "final" ||
    match.sourceState?.proposedStatus === "final";
  if (correction && match.stage === "playoffs") {
    return observation(sheet, "invalid", [
      ...issues,
      problem(
        "PLAYOFF_CORRECTION_DEFERRED",
        "Playoff corrections require the dependent-result analysis introduced in Phase 5."
      )
    ], observationBase);
  }
  const participantDigest = createWorkbookParticipantDigest(match.participants);
  const sourceRevisionNumber = (match.sourceState?.sourceRevisionNumber ?? 0) + 1;
  const previousCandidateId = match.sourceState?.candidateId;
  const candidate: WorkbookMatchRevisionCandidate = {
    id: createUuidV5(
      match.matchId,
      ["workbook-source", previousCandidateId ?? "none", fingerprint].join("|")
    ),
    tournamentId,
    matchId: match.matchId,
    sourceRevisionNumber,
    previousCandidateId,
    fingerprint,
    proposedStatus: sheet.status === "FINAL" ? "final" : "in_progress",
    proposedScoreAvailability: availability(normalizedRows, sheet.status),
    reason: correction
      ? "correction"
      : match.sourceState === undefined ? "initial" : "workbook_update",
    requiresConfirmation: correction,
    requiresCorrectionReason: correction,
    expectedMatchRowVersion: match.matchRowVersion,
    expectedSourceStateRowVersion: match.sourceState?.rowVersion,
    participantDigest,
    participants: match.participants.map((participant) => ({
      sideNumber: participant.sideNumber,
      teamId: participant.teamId,
      playerId: participant.playerId,
      rosterMembershipId: participant.rosterMembershipId,
      rosterSlot: participant.rosterSlot,
      displayNameAtImport: participant.displayName
    })),
    rawRows: normalizedRows,
    formulaSummaryObservations: sheet.formulaSummaryObservations ?? []
  };
  return observation(sheet, "proposed", issues, { ...observationBase, candidate });
}

function availability(
  rows: readonly NormalizedWorkbookShotRow[],
  status: ParsedCanonicalScorecardSheet["status"]
) {
  if (status === "LIVE GAME") {
    return "partial" as const;
  }
  const hasShot = rows.some((row) =>
    row.markers.make || row.markers.miss || row.markers.splashOut ||
    row.markers.guy || row.markers.tri || row.markers.di
  );
  return hasShot ? "complete" as const : "unrecorded" as const;
}

function bindStableRowIdentity(
  sheet: ParsedCanonicalScorecardSheet,
  match: CanonicalMatchReconciliationScope,
  issues: WorkbookIssue[]
): NormalizedWorkbookShotRow[] {
  const participantBySlot = new Map(
    match.participants.map((participant) => [
      `${participant.sideNumber}:${participant.rosterSlot}`,
      participant
    ])
  );
  return sheet.rows.map((row) => {
    const rosterSlot = (row.worksheetRow - 10) % sheet.playersPerTeam + 1;
    const participant = participantBySlot.get(`${row.sideNumber}:${rosterSlot}`);
    if (participant === undefined) {
      issues.push(problem(
        "SCORECARD_ROW_IDENTITY_UNAVAILABLE",
        "Scorecard row cannot be mapped to an exact frozen participant identity."
      ));
      const fallback = match.participants[0];
      if (fallback === undefined) {
        throw new Error("Validated match scope has no participant identities.");
      }
      return normalizedRow(row, fallback, rosterSlot);
    }
    if (
      Object.values(row.markers).some(Boolean) &&
      normalizeDisplay(row.observedShooter) !== normalizeDisplay(participant.displayName)
    ) {
      issues.push(warning(
        "SCORECARD_SHOOTER_DISPLAY_MISMATCH",
        "Visible shooter text differs from stable row ownership and was ignored for identity."
      ));
    }
    return normalizedRow(row, participant, rosterSlot);
  });
}

function normalizedRow(
  row: ParsedCanonicalScorecardSheet["rows"][number],
  participant: CanonicalMatchReconciliationScope["participants"][number],
  rosterSlot: number
): NormalizedWorkbookShotRow {
  return {
    sideNumber: row.sideNumber,
    worksheetRow: row.worksheetRow,
    shotNumber: row.shotNumber,
    teamId: participant.teamId,
    playerId: participant.playerId,
    rosterMembershipId: participant.rosterMembershipId,
    rosterSlot,
    markers: row.markers
  };
}

function normalizeDisplay(value: string | null): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function isStatusRegression(
  status: ParsedCanonicalScorecardSheet["status"],
  match: CanonicalMatchReconciliationScope
): boolean {
  if (match.canonicalStatus === "final" || match.sourceState?.proposedStatus === "final") {
    return status !== "FINAL";
  }
  return match.sourceState !== undefined && status === "SCHEDULED";
}

function observeUnassignedBlanks(
  blanks: readonly ParsedCanonicalScorecardSheet[],
  manifest: readonly ParsedCanonicalWorkbookManifestEntry[]
): WorkbookSheetObservation[] {
  const blankManifestIds = new Set(
    manifest.filter((entry) => entry.sheetKind === "blank").map((entry) => entry.sheetId)
  );
  const groups = new Map<string, ParsedCanonicalScorecardSheet[]>();
  blanks.forEach((sheet) => groups.set(sheet.sheetId, [...(groups.get(sheet.sheetId) ?? []), sheet]));
  return blanks.map((sheet) => {
    const peers = groups.get(sheet.sheetId) ?? [];
    const pristine =
      blankManifestIds.has(sheet.sheetId) &&
      peers.length === 1 &&
      sheet.status === "SCHEDULED" &&
      !sheet.rows.some((row) => Object.values(row.markers).some(Boolean)) &&
      !sheet.issues.some((issue) => issue.severity === "error");
    return pristine
      ? observation(sheet, "unchanged", sheet.issues)
      : observation(sheet, "unresolved", [
        ...sheet.issues,
        problem(
          "COPIED_BLANK_ASSIGNMENT_REQUIRED",
          "Copied or edited blank scorecard requires an explicit stable match assignment."
        )
      ]);
  });
}

function rejectDuplicateBindings(
  observations: readonly WorkbookSheetObservation[]
): WorkbookSheetObservation[] {
  const counts = new Map<string, number>();
  observations.forEach((item) => {
    if (item.matchId !== undefined && item.decision !== "invalid") {
      counts.set(item.matchId, (counts.get(item.matchId) ?? 0) + 1);
    }
  });
  return observations.map((item) => {
    if (item.matchId === undefined || (counts.get(item.matchId) ?? 0) <= 1) {
      return item;
    }
    return {
      ...item,
      decision: "invalid",
      candidate: undefined,
      issues: [
        ...item.issues,
        problem(
          "DUPLICATE_MATCH_SCORECARD",
          "Multiple workbook sheets resolve to the same stable match identity."
        )
      ]
    };
  });
}

function missingObservation(
  entry: ParsedCanonicalWorkbookManifestEntry
): WorkbookSheetObservation {
  const issue = warning(
    "MISSING_SCORECARD_NON_DESTRUCTIVE",
    "Expected scorecard is missing; previously accepted match state remains unchanged."
  );
  return {
    id: canonicalSha256({ decision: "missing_non_destructive", sheetId: entry.sheetId }),
    sheetId: entry.sheetId,
    worksheetName: entry.sheetName,
    matchId: entry.matchId,
    decision: "missing_non_destructive",
    issues: [issue]
  };
}

function observation(
  sheet: ParsedCanonicalScorecardSheet,
  decision: WorkbookSheetObservation["decision"],
  issues: readonly WorkbookIssue[],
  extra: Partial<WorkbookSheetObservation> = {}
): WorkbookSheetObservation {
  const fields = {
    worksheetIndex: sheet.worksheetIndex,
    worksheetName: sheet.worksheetName,
    sheetId: sheet.sheetId,
    formulaSummaryObservations: sheet.formulaSummaryObservations ?? [],
    ...extra
  };
  return {
    id: canonicalSha256({
      worksheetIndex: fields.worksheetIndex,
      sheetId: fields.sheetId,
      matchId: fields.matchId ?? null,
      fingerprint: fields.fingerprint ?? null,
      decision
    }),
    ...fields,
    decision,
    issues
  };
}

function equalPair(
  left: readonly [string, string] | undefined,
  right: readonly [string, string]
): boolean {
  return left !== undefined && left[0] === right[0] && left[1] === right[1];
}

function compareObservation(
  left: WorkbookSheetObservation,
  right: WorkbookSheetObservation
): number {
  return (left.worksheetIndex ?? Number.MAX_SAFE_INTEGER) -
    (right.worksheetIndex ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id);
}

function problem(code: string, message: string): WorkbookIssue {
  return { code, severity: "error", message };
}

function warning(code: string, message: string): WorkbookIssue {
  return { code, severity: "warning", message };
}
