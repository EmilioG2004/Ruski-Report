import {
  isStableUuid,
  MatchRevisionId,
  parseStableUuid,
  RosterMembershipId,
  ScoringEventId,
  TournamentId,
  TournamentPlayerId,
  TournamentTeamId
} from "../domain";
import {
  MatchRevisionEventInput,
  MatchRevisionTeamInput
} from "../persistence/contracts";
import { createUuidV5 } from "../scheduling/uuid-v5";
import {
  digestWorkbookParticipants,
  digestWorkbookValue,
  WorkbookRevisionCandidateInput
} from "../workbook/persistence/contracts";
import { reduceCanonicalRuskiEvents } from "./canonical-event.reducer";
import {
  MaterializedWorkbookCandidate,
  MaterializeWorkbookCandidateInput,
  RUSKI_CANONICAL_SCORING_RULES_VERSION,
  WorkbookCandidateScoringPreview
} from "./contracts";
import {
  CanonicalScoringValidationError,
  rejectScoring,
  scoringIssue
} from "./errors";

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const V1_CONTRACT = "workbook-match-revision-candidate-v1";
const V2_CONTRACT = "workbook-match-revision-candidate-v2";
const V1_KEYS = new Set([
  "contract",
  "semanticCandidateId",
  "tournamentId",
  "matchId",
  "sourceRevisionNumber",
  "previousCandidateId",
  "fingerprint",
  "proposedStatus",
  "proposedScoreAvailability",
  "reason",
  "participantDigest",
  "participants",
  "rows"
]);

interface CandidateParticipant {
  readonly sideNumber: 1 | 2;
  readonly teamId: TournamentTeamId;
  readonly playerId: TournamentPlayerId;
  readonly rosterMembershipId: RosterMembershipId;
  readonly rosterSlot: number;
}

interface CandidateMarkers {
  readonly miss: boolean;
  readonly make: boolean;
  readonly splashOut: boolean;
  readonly guy: boolean;
  readonly tri: boolean;
  readonly di: boolean;
  readonly vom: boolean;
}

interface CandidateRow extends CandidateParticipant {
  readonly worksheetRow: number;
  readonly shotNumber: number;
  readonly markers: CandidateMarkers;
}

interface ParsedCandidate {
  readonly semanticCandidateId: string;
  readonly tournamentId: TournamentId;
  readonly matchId: WorkbookRevisionCandidateInput["matchId"];
  readonly participants: readonly CandidateParticipant[];
  readonly rows: readonly CandidateRow[];
}

export function previewWorkbookCandidate(
  candidate: WorkbookRevisionCandidateInput
): WorkbookCandidateScoringPreview {
  const parsed = parseCandidate(candidate);
  const revisionId = stableRevisionId(candidate);
  const events = createEvents(candidate, parsed, revisionId);
  const reduction = reduceCanonicalRuskiEvents(events);
  const teamTotals = new Map<string, typeof reduction.match>(
    reduction.teams.map((team) => [team.teamId, team.totals])
  );
  const scored = candidate.proposedScoreAvailability !== "unrecorded";
  const scores = new Map(candidate.teams.map((team) => [
    team.teamId,
    teamTotals.get(team.teamId)?.cupsScored ?? 0
  ]));
  const winnerTeamId = finalWinner(candidate, scores);
  const teams = canonicalTeams(candidate, scores, scored, winnerTeamId);

  return {
    persistedCandidateId: candidate.candidateId,
    semanticCandidateId: parsed.semanticCandidateId,
    tournamentId: parsed.tournamentId,
    matchId: parsed.matchId,
    revisionId,
    status: candidate.proposedStatus,
    scoreAvailability: candidate.proposedScoreAvailability,
    teams,
    events,
    ...(winnerTeamId === undefined ? {} : { winnerTeamId }),
    reduction
  };
}

export function materializeWorkbookCandidate(
  input: MaterializeWorkbookCandidateInput
): MaterializedWorkbookCandidate {
  validateMaterializationContext(input);
  const preview = previewWorkbookCandidate(input.candidate);
  if (preview.tournamentId !== input.tournamentId) {
    rejectScoring(
      "CANDIDATE_TOURNAMENT_MISMATCH",
      "Workbook candidate belongs to another tournament.",
      "tournamentId"
    );
  }
  const expectedRevisionNumber = (input.activeRevision?.revisionNumber ?? 0) + 1;
  const correctionReason = normalizedCorrectionReason(input);
  const sourceReference = [
    "workbook-import",
    input.batchId,
    input.observationId,
    input.candidate.candidateId
  ].join(":");

  return {
    preview,
    activation: {
      tournamentId: input.tournamentId,
      matchId: parseStableUuid(input.candidate.matchId, "match"),
      expectedMatchRowVersion: input.candidate.expectedMatchRowVersion,
      revision: {
        id: preview.revisionId,
        publicKey: `workbook-revision-${preview.revisionId}`,
        revisionNumber: expectedRevisionNumber,
        ...(input.activeRevision === undefined
          ? {}
          : { previousRevisionId: input.activeRevision.id }),
        status: preview.status,
        scoreAvailability: preview.scoreAvailability,
        reason: input.candidate.reason,
        sourceAdapter: "excel_import",
        sourceReference,
        actorId: input.actorId.trim(),
        ...(correctionReason === undefined ? {} : { correctionReason }),
        confirmationDigest: input.confirmationDigest,
        createdAt: input.createdAt,
        metadata: {
          scoringRulesVersion: RUSKI_CANONICAL_SCORING_RULES_VERSION,
          workbookCandidateId: input.candidate.candidateId,
          semanticCandidateId: preview.semanticCandidateId,
          workbookSourceRevisionNumber: input.candidate.sourceRevisionNumber,
          workbookFingerprint: input.candidate.fingerprint,
          workbookBatchId: input.batchId,
          workbookObservationId: input.observationId,
          sourcePhaseAvailability: "unrecorded"
        }
      },
      teams: preview.teams,
      events: preview.events
    }
  };
}

function parseCandidate(candidate: WorkbookRevisionCandidateInput): ParsedCandidate {
  const issues = [];
  if (!isStableUuid(candidate.candidateId)) {
    issues.push(scoringIssue(
      "CANDIDATE_ID_INVALID",
      "Persisted workbook candidate ID must be a stable UUID.",
      "candidateId"
    ));
  }
  if (!DIGEST_PATTERN.test(candidate.envelopeDigest) ||
      digestWorkbookValue(candidate.envelope) !== candidate.envelopeDigest) {
    issues.push(scoringIssue(
      "CANDIDATE_ENVELOPE_DIGEST_INVALID",
      "Persisted workbook candidate envelope digest does not match.",
      "envelopeDigest"
    ));
  }
  const envelope = candidate.envelope;
  const contract = envelope.contract;
  const expectedContract = candidate.envelopeSchemaVersion === 1
    ? V1_CONTRACT
    : candidate.envelopeSchemaVersion === 2 ? V2_CONTRACT : undefined;
  if (contract !== expectedContract) {
    issues.push(scoringIssue(
      "CANDIDATE_CONTRACT_UNSUPPORTED",
      "Workbook candidate envelope contract or schema version is unsupported.",
      "envelope.contract"
    ));
  }
  if (contract === V1_CONTRACT) {
    const unexpected = Object.keys(envelope).filter((key) => !V1_KEYS.has(key));
    if (unexpected.length > 0) {
      issues.push(scoringIssue(
        "CANDIDATE_V1_FIELD_UNEXPECTED",
        "Workbook candidate v1 contains an unexpected field.",
        `envelope.${unexpected.sort()[0]}`
      ));
    }
  }
  const semanticCandidateId = requiredUuid(
    envelope.semanticCandidateId,
    "CANDIDATE_SEMANTIC_ID_INVALID",
    "envelope.semanticCandidateId",
    issues
  );
  const tournamentId = requiredUuid(
    envelope.tournamentId,
    "CANDIDATE_TOURNAMENT_ID_INVALID",
    "envelope.tournamentId",
    issues
  );
  const matchId = requiredUuid(
    envelope.matchId,
    "CANDIDATE_MATCH_ID_INVALID",
    "envelope.matchId",
    issues
  );
  compareHeader(candidate, envelope, issues);
  validateCandidateHeader(candidate, issues);
  const participants = parseParticipants(envelope.participants, issues);
  validateParticipantsAgainstLedger(candidate, participants, issues);
  const playersPerTeam = validateParticipantShape(participants, issues);
  const rows = parseRows(envelope.rows, issues);
  validateRows(rows, participants, playersPerTeam, issues);

  if (issues.length > 0 || semanticCandidateId === undefined ||
      tournamentId === undefined || matchId === undefined) {
    throw new CanonicalScoringValidationError(issues);
  }
  return {
    semanticCandidateId,
    tournamentId: parseStableUuid(tournamentId, "tournament"),
    matchId: parseStableUuid(matchId, "match"),
    participants,
    rows
  };
}

function compareHeader(
  candidate: WorkbookRevisionCandidateInput,
  envelope: Readonly<Record<string, unknown>>,
  issues: ReturnType<typeof scoringIssue>[]
): void {
  const fields: Array<[string, unknown, unknown]> = [
    ["matchId", candidate.matchId, envelope.matchId],
    ["sourceRevisionNumber", candidate.sourceRevisionNumber, envelope.sourceRevisionNumber],
    ["previousCandidateId", candidate.previousAppliedCandidateId ?? null,
      envelope.previousCandidateId],
    ["fingerprint", candidate.fingerprint, envelope.fingerprint],
    ["proposedStatus", candidate.proposedStatus, envelope.proposedStatus],
    ["proposedScoreAvailability", candidate.proposedScoreAvailability,
      envelope.proposedScoreAvailability],
    ["reason", candidate.reason, envelope.reason],
    ["participantDigest", candidate.participantDigest, envelope.participantDigest]
  ];
  fields.forEach(([field, expected, actual]) => {
    if (actual !== expected) {
      issues.push(scoringIssue(
        "CANDIDATE_HEADER_MISMATCH",
        `Workbook candidate envelope field '${field}' does not match its persisted header.`,
        `envelope.${field}`
      ));
    }
  });
}

function validateCandidateHeader(
  candidate: WorkbookRevisionCandidateInput,
  issues: ReturnType<typeof scoringIssue>[]
): void {
  if (!isStableUuid(candidate.matchId)) {
    issues.push(scoringIssue(
      "CANDIDATE_MATCH_ID_INVALID",
      "Workbook candidate match ID must be a stable UUID.",
      "matchId"
    ));
  }
  if (!Number.isSafeInteger(candidate.sourceRevisionNumber) ||
      candidate.sourceRevisionNumber <= 0 ||
      candidate.expectedSourceStateVersion !== candidate.sourceRevisionNumber - 1) {
    issues.push(scoringIssue(
      "CANDIDATE_SOURCE_REVISION_INVALID",
      "Workbook source revision must extend its exact source-state version.",
      "sourceRevisionNumber"
    ));
  }
  if ((candidate.sourceRevisionNumber === 1) !==
      (candidate.previousAppliedCandidateId === undefined)) {
    issues.push(scoringIssue(
      "CANDIDATE_PREVIOUS_SOURCE_INVALID",
      "Only the first workbook source revision may omit its previous candidate.",
      "previousAppliedCandidateId"
    ));
  }
  if (candidate.previousAppliedCandidateId !== undefined &&
      !isStableUuid(candidate.previousAppliedCandidateId)) {
    issues.push(scoringIssue(
      "CANDIDATE_PREVIOUS_SOURCE_INVALID",
      "Previous workbook candidate ID must be a stable UUID.",
      "previousAppliedCandidateId"
    ));
  }
  if (!Number.isSafeInteger(candidate.expectedMatchRowVersion) ||
      candidate.expectedMatchRowVersion <= 0) {
    issues.push(scoringIssue(
      "CANDIDATE_MATCH_VERSION_INVALID",
      "Workbook candidate match row version must be positive.",
      "expectedMatchRowVersion"
    ));
  }
  if (!DIGEST_PATTERN.test(candidate.fingerprint) ||
      !DIGEST_PATTERN.test(candidate.participantDigest)) {
    issues.push(scoringIssue(
      "CANDIDATE_DIGEST_INVALID",
      "Workbook candidate fingerprints and participant digests must be SHA-256 values."
    ));
  }
  const statusValid =
    (candidate.proposedStatus === "in_progress" &&
      candidate.proposedScoreAvailability === "partial") ||
    (candidate.proposedStatus === "final" &&
      (candidate.proposedScoreAvailability === "complete" ||
       candidate.proposedScoreAvailability === "unrecorded"));
  if (!statusValid) {
    issues.push(scoringIssue(
      "CANDIDATE_STATUS_AVAILABILITY_INVALID",
      "Workbook status and score availability are inconsistent.",
      "proposedScoreAvailability"
    ));
  }
  if ((candidate.reason === "correction") !== candidate.requiresConfirmation) {
    issues.push(scoringIssue(
      "CANDIDATE_CONFIRMATION_POLICY_INVALID",
      "Only workbook corrections require explicit confirmation.",
      "requiresConfirmation"
    ));
  }
  const expectedParticipantDigest = digestWorkbookParticipants(candidate.teams);
  if (candidate.participantDigest !== expectedParticipantDigest) {
    issues.push(scoringIssue(
      "CANDIDATE_PARTICIPANT_DIGEST_INVALID",
      "Workbook participant digest does not match its persisted participant ledger.",
      "participantDigest"
    ));
  }
}

function parseParticipants(
  value: unknown,
  issues: ReturnType<typeof scoringIssue>[]
): CandidateParticipant[] {
  if (!Array.isArray(value)) {
    issues.push(scoringIssue(
      "CANDIDATE_PARTICIPANTS_INVALID",
      "Workbook candidate participants must be an array.",
      "envelope.participants"
    ));
    return [];
  }
  return value.flatMap((item, index) => {
    const path = `envelope.participants.${index}`;
    if (!isRecord(item)) {
      issues.push(scoringIssue(
        "CANDIDATE_PARTICIPANT_INVALID",
        "Workbook candidate participant must be an object.",
        path
      ));
      return [];
    }
    const sideNumber = side(item.sideNumber);
    const rosterSlot = positiveInteger(item.rosterSlot);
    const teamId = uuidText(item.teamId);
    const playerId = uuidText(item.playerId);
    const membershipId = uuidText(item.rosterMembershipId);
    if (sideNumber === undefined || rosterSlot === undefined ||
        teamId === undefined || playerId === undefined ||
        membershipId === undefined) {
      issues.push(scoringIssue(
        "CANDIDATE_PARTICIPANT_INVALID",
        "Workbook candidate participant identity is invalid.",
        path
      ));
      return [];
    }
    return [{
      sideNumber,
      rosterSlot,
      teamId: parseStableUuid(teamId, "tournament_team"),
      playerId: parseStableUuid(playerId, "tournament_player"),
      rosterMembershipId: parseStableUuid(membershipId, "roster_membership")
    }];
  });
}

function validateParticipantsAgainstLedger(
  candidate: WorkbookRevisionCandidateInput,
  participants: readonly CandidateParticipant[],
  issues: ReturnType<typeof scoringIssue>[]
): void {
  const envelopeKeys = participants.map(participantKey).sort();
  const ledgerKeys = candidate.teams.flatMap((team) =>
    team.players.map((player) => participantKey({
      sideNumber: team.sideNumber,
      teamId: parseCandidateUuid(team.teamId, "tournament_team", issues),
      playerId: parseCandidateUuid(player.playerId, "tournament_player", issues),
      rosterMembershipId: parseCandidateUuid(
        player.rosterMembershipId,
        "roster_membership",
        issues
      ),
      rosterSlot: player.rosterSlot
    }))
  ).sort();
  if (envelopeKeys.join("|") !== ledgerKeys.join("|")) {
    issues.push(scoringIssue(
      "CANDIDATE_PARTICIPANT_LEDGER_MISMATCH",
      "Workbook envelope participants do not match the persisted participant ledger.",
      "envelope.participants"
    ));
  }
}

function validateParticipantShape(
  participants: readonly CandidateParticipant[],
  issues: ReturnType<typeof scoringIssue>[]
): number {
  const counts = [1, 2].map((sideNumber) =>
    participants.filter((item) => item.sideNumber === sideNumber).length
  );
  const playersPerTeam = counts[0] ?? 0;
  const ids = participants.flatMap((item) => [item.playerId, item.rosterMembershipId]);
  const teamIds = new Set(participants.map((item) => item.teamId));
  if (playersPerTeam < 1 || playersPerTeam > 8 || counts[1] !== playersPerTeam ||
      new Set(ids).size !== ids.length || teamIds.size !== 2) {
    issues.push(scoringIssue(
      "CANDIDATE_PARTICIPANT_SHAPE_INVALID",
      "Workbook candidate requires equal one-to-eight-player sides with unique identities.",
      "envelope.participants"
    ));
  }
  for (const sideNumber of [1, 2] as const) {
    const sideParticipants = participants
      .filter((item) => item.sideNumber === sideNumber)
      .sort((left, right) => left.rosterSlot - right.rosterSlot);
    if (sideParticipants.some((item, index) => item.rosterSlot !== index + 1) ||
        new Set(sideParticipants.map((item) => item.teamId)).size !== 1) {
      issues.push(scoringIssue(
        "CANDIDATE_ROSTER_SLOTS_INVALID",
        "Workbook candidate roster slots must be contiguous within one team per side.",
        `envelope.participants.side${sideNumber}`
      ));
    }
  }
  return playersPerTeam;
}

function parseRows(
  value: unknown,
  issues: ReturnType<typeof scoringIssue>[]
): CandidateRow[] {
  if (!Array.isArray(value)) {
    issues.push(scoringIssue(
      "CANDIDATE_ROWS_INVALID",
      "Workbook candidate rows must be an array.",
      "envelope.rows"
    ));
    return [];
  }
  return value.flatMap((item, index) => {
    const path = `envelope.rows.${index}`;
    if (!isRecord(item) || !isRecord(item.markers)) {
      issues.push(scoringIssue(
        "CANDIDATE_ROW_INVALID",
        "Workbook candidate row must contain marker data.",
        path
      ));
      return [];
    }
    const sideNumber = side(item.sideNumber);
    const worksheetRow = positiveInteger(item.worksheetRow);
    const shotNumber = positiveInteger(item.shotNumber);
    const rosterSlot = positiveInteger(item.rosterSlot);
    const teamId = uuidText(item.teamId);
    const playerId = uuidText(item.playerId);
    const membershipId = uuidText(item.rosterMembershipId);
    const markers = parseMarkers(item.markers, issues, `${path}.markers`);
    if (sideNumber === undefined || worksheetRow === undefined ||
        shotNumber === undefined || rosterSlot === undefined ||
        teamId === undefined || playerId === undefined ||
        membershipId === undefined || markers === undefined) {
      issues.push(scoringIssue(
        "CANDIDATE_ROW_INVALID",
        "Workbook candidate row identity or shot sequence is invalid.",
        path
      ));
      return [];
    }
    return [{
      sideNumber,
      worksheetRow,
      shotNumber,
      rosterSlot,
      teamId: parseStableUuid(teamId, "tournament_team"),
      playerId: parseStableUuid(playerId, "tournament_player"),
      rosterMembershipId: parseStableUuid(membershipId, "roster_membership"),
      markers
    }];
  });
}

function parseMarkers(
  value: Readonly<Record<string, unknown>>,
  issues: ReturnType<typeof scoringIssue>[],
  path: string
): CandidateMarkers | undefined {
  const keys = ["miss", "make", "splashOut", "guy", "tri", "di", "vom"] as const;
  const unexpected = Object.keys(value).filter((key) => !keys.includes(key as never));
  if (unexpected.length > 0 || keys.some((key) => typeof value[key] !== "boolean")) {
    issues.push(scoringIssue(
      "CANDIDATE_MARKERS_INVALID",
      "Workbook candidate markers must contain exactly seven boolean fields.",
      path
    ));
    return undefined;
  }
  const markers = Object.fromEntries(keys.map((key) => [key, value[key]])) as
    unknown as CandidateMarkers;
  const specialCount = [markers.splashOut, markers.guy, markers.tri, markers.di]
    .filter(Boolean).length;
  if (specialCount > 1 ||
      (markers.make && (markers.miss || specialCount > 0)) ||
      (specialCount > 0 && !markers.miss)) {
    issues.push(scoringIssue(
      "CANDIDATE_MARKER_COMBINATION_INVALID",
      "Make/miss and special-miss markers are incompatible.",
      path
    ));
  }
  return markers;
}

function validateRows(
  rows: readonly CandidateRow[],
  participants: readonly CandidateParticipant[],
  playersPerTeam: number,
  issues: ReturnType<typeof scoringIssue>[]
): void {
  if (rows.length !== 160) {
    issues.push(scoringIssue(
      "CANDIDATE_ROW_SET_INVALID",
      "Workbook candidate must preserve all eighty structural rows per side.",
      "envelope.rows"
    ));
  }
  if (playersPerTeam < 1 || playersPerTeam > 8) {
    return;
  }
  const participantBySlot = new Map(participants.map((item) => [
    `${item.sideNumber}:${item.rosterSlot}`,
    item
  ]));
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const path = `envelope.rows.${index}`;
    const key = `${row.sideNumber}:${row.worksheetRow}`;
    const expectedSlot = (row.worksheetRow - 10) % playersPerTeam + 1;
    const expectedShot = Math.floor((row.worksheetRow - 10) / playersPerTeam) + 1;
    const participant = participantBySlot.get(`${row.sideNumber}:${expectedSlot}`);
    if (row.worksheetRow < 10 || row.worksheetRow > 89 || seen.has(key) ||
        row.rosterSlot !== expectedSlot || row.shotNumber !== expectedShot) {
      issues.push(scoringIssue(
        "CANDIDATE_ROW_SEQUENCE_INVALID",
        "Workbook candidate row does not match its stable scorecard sequence.",
        path
      ));
    }
    seen.add(key);
    if (participant === undefined || row.teamId !== participant.teamId ||
        row.playerId !== participant.playerId ||
        row.rosterMembershipId !== participant.rosterMembershipId) {
      issues.push(scoringIssue(
        "CANDIDATE_ROW_IDENTITY_MISMATCH",
        "Workbook candidate row does not belong to its stable participant slot.",
        path
      ));
    }
  });
  for (const sideNumber of [1, 2] as const) {
    for (let worksheetRow = 10; worksheetRow <= 89; worksheetRow += 1) {
      if (!seen.has(`${sideNumber}:${worksheetRow}`)) {
        issues.push(scoringIssue(
          "CANDIDATE_ROW_SET_INVALID",
          "Workbook candidate structural row set is incomplete.",
          `envelope.rows.side${sideNumber}.${worksheetRow}`
        ));
        return;
      }
    }
  }
}

function createEvents(
  candidate: WorkbookRevisionCandidateInput,
  parsed: ParsedCandidate,
  revisionId: MatchRevisionId
): MatchRevisionEventInput[] {
  const activeRows = [...parsed.rows]
    .filter((row) => row.markers.make || row.markers.miss || row.markers.vom)
    .sort((left, right) =>
      left.shotNumber - right.shotNumber ||
      left.sideNumber - right.sideNumber ||
      left.rosterSlot - right.rosterSlot ||
      left.worksheetRow - right.worksheetRow
    );
  const events: MatchRevisionEventInput[] = [];
  activeRows.forEach((row) => {
    if (row.markers.make || row.markers.miss) {
      events.push(createAttemptEvent(candidate, parsed, revisionId, row, events.length + 1));
    }
    if (row.markers.vom) {
      events.push(createVomEvent(candidate, parsed, revisionId, row, events.length + 1));
    }
  });
  const hasAttempt = events.some((event) => event.type === "shot_attempt");
  if (candidate.proposedScoreAvailability === "complete" && !hasAttempt) {
    rejectScoring(
      "CANDIDATE_COMPLETE_SCORE_EMPTY",
      "A complete workbook score requires at least one shot attempt.",
      "proposedScoreAvailability"
    );
  }
  if (candidate.proposedScoreAvailability === "unrecorded" && hasAttempt) {
    rejectScoring(
      "CANDIDATE_UNRECORDED_SCORE_HAS_ATTEMPTS",
      "An unrecorded workbook score cannot contain shot attempts.",
      "proposedScoreAvailability"
    );
  }
  return events;
}

function createAttemptEvent(
  candidate: WorkbookRevisionCandidateInput,
  parsed: ParsedCandidate,
  revisionId: MatchRevisionId,
  row: CandidateRow,
  sequence: number
): MatchRevisionEventInput {
  const classification = row.markers.splashOut ? "splash_out" as const
    : row.markers.guy ? "guy" as const
    : row.markers.tri ? "tri" as const
    : row.markers.di ? "di" as const
    : undefined;
  const outcome = row.markers.make ? "make" as const : "miss" as const;
  const cupDelta = outcome === "make" ? 1
    : classification === "di" ? 2
    : classification === "tri" ? 3
    : 0;
  return {
    id: eventId(revisionId, row, "shot_attempt"),
    sequence,
    type: "shot_attempt",
    teamId: row.teamId,
    playerId: row.playerId,
    sourceReference: eventSourceReference(candidate.candidateId, row, "shot_attempt"),
    shotAttempt: {
      outcome,
      ...(classification === undefined ? {} : { classification }),
      cupDelta,
      turnNumber: row.shotNumber,
      teamTurnOrder: row.sideNumber,
      shotInTeamTurn: row.rosterSlot
    },
    metadata: eventMetadata(parsed, row)
  };
}

function createVomEvent(
  candidate: WorkbookRevisionCandidateInput,
  parsed: ParsedCandidate,
  revisionId: MatchRevisionId,
  row: CandidateRow,
  sequence: number
): MatchRevisionEventInput {
  return {
    id: eventId(revisionId, row, "vom"),
    sequence,
    type: "vom",
    teamId: row.teamId,
    playerId: row.playerId,
    sourceReference: eventSourceReference(candidate.candidateId, row, "vom"),
    metadata: eventMetadata(parsed, row)
  };
}

function eventMetadata(parsed: ParsedCandidate, row: CandidateRow) {
  return {
    sourceContract: "canonical-workbook-scorecard-v1",
    semanticCandidateId: parsed.semanticCandidateId,
    worksheetRow: row.worksheetRow,
    sourceShotNumber: row.shotNumber,
    sideNumber: row.sideNumber,
    rosterSlot: row.rosterSlot,
    sourcePhaseAvailability: "unrecorded"
  };
}

function eventId(
  revisionId: MatchRevisionId,
  row: CandidateRow,
  kind: "shot_attempt" | "vom"
): ScoringEventId {
  return parseStableUuid(
    createUuidV5(
      revisionId,
      `event|side:${row.sideNumber}|row:${row.worksheetRow}|kind:${kind}`
    ),
    "scoring_event"
  );
}

function eventSourceReference(
  candidateId: string,
  row: CandidateRow,
  kind: "shot_attempt" | "vom"
): string {
  return [
    "workbook-candidate",
    candidateId,
    `side-${row.sideNumber}`,
    `row-${row.worksheetRow}`,
    kind
  ].join(":");
}

function stableRevisionId(candidate: WorkbookRevisionCandidateInput): MatchRevisionId {
  return parseStableUuid(
    createUuidV5(candidate.matchId, `excel-revision|${candidate.candidateId}`),
    "match_revision"
  );
}

function finalWinner(
  candidate: WorkbookRevisionCandidateInput,
  scores: ReadonlyMap<string, number>
): TournamentTeamId | undefined {
  if (candidate.proposedStatus !== "final" ||
      candidate.proposedScoreAvailability === "unrecorded") {
    return undefined;
  }
  const [first, second] = [...candidate.teams]
    .sort((left, right) => left.sideNumber - right.sideNumber);
  const firstScore = scores.get(first.teamId) ?? 0;
  const secondScore = scores.get(second.teamId) ?? 0;
  if (firstScore === secondScore) {
    rejectScoring(
      "CANDIDATE_FINAL_SCORE_TIED",
      "A final Ruski scorecard must produce one winner.",
      "envelope.rows"
    );
  }
  return parseStableUuid(
    firstScore > secondScore ? first.teamId : second.teamId,
    "tournament_team"
  );
}

function canonicalTeams(
  candidate: WorkbookRevisionCandidateInput,
  scores: ReadonlyMap<string, number>,
  scored: boolean,
  winnerTeamId: TournamentTeamId | undefined
): MatchRevisionTeamInput[] {
  return [...candidate.teams]
    .sort((left, right) => left.sideNumber - right.sideNumber)
    .map((team): MatchRevisionTeamInput => ({
      sideNumber: team.sideNumber,
      teamId: parseStableUuid(team.teamId, "tournament_team"),
      displayName: requiredDisplay(team.displayName, "candidate.teams.displayName"),
      ...(scored ? { score: scores.get(team.teamId) ?? 0 } : {}),
      result: winnerTeamId === undefined
        ? "pending"
        : team.teamId === winnerTeamId ? "win" : "loss",
      players: [...team.players]
        .sort((left, right) => left.rosterSlot - right.rosterSlot)
        .map((player) => ({
          playerId: parseStableUuid(player.playerId, "tournament_player"),
          rosterMembershipId: parseStableUuid(
            player.rosterMembershipId,
            "roster_membership"
          ),
          rosterSlot: player.rosterSlot,
          displayName: requiredDisplay(
            player.displayName,
            "candidate.teams.players.displayName"
          )
        }))
    }));
}

function validateMaterializationContext(input: MaterializeWorkbookCandidateInput): void {
  const issues = [];
  for (const [field, value] of [
    ["batchId", input.batchId],
    ["observationId", input.observationId]
  ] as const) {
    if (!isStableUuid(value)) {
      issues.push(scoringIssue(
        "MATERIALIZATION_ID_INVALID",
        `${field} must be a stable UUID.`,
        field
      ));
    }
  }
  if (input.actorId.trim().length === 0) {
    issues.push(scoringIssue(
      "MATERIALIZATION_ACTOR_INVALID",
      "Workbook materialization requires an actor ID.",
      "actorId"
    ));
  }
  if (!Number.isFinite(Date.parse(input.createdAt))) {
    issues.push(scoringIssue(
      "MATERIALIZATION_TIMESTAMP_INVALID",
      "Workbook materialization timestamp is invalid.",
      "createdAt"
    ));
  }
  if (!DIGEST_PATTERN.test(input.confirmationDigest)) {
    issues.push(scoringIssue(
      "MATERIALIZATION_CONFIRMATION_DIGEST_INVALID",
      "Workbook materialization confirmation digest is invalid.",
      "confirmationDigest"
    ));
  }
  if (input.activeRevision !== undefined &&
      (!isStableUuid(input.activeRevision.id) ||
       !Number.isSafeInteger(input.activeRevision.revisionNumber) ||
       input.activeRevision.revisionNumber <= 0)) {
    issues.push(scoringIssue(
      "MATERIALIZATION_ACTIVE_REVISION_INVALID",
      "Active revision context is invalid.",
      "activeRevision"
    ));
  }
  if (issues.length > 0) {
    throw new CanonicalScoringValidationError(issues);
  }
}

function normalizedCorrectionReason(
  input: MaterializeWorkbookCandidateInput
): string | undefined {
  const reason = input.correctionReason?.trim();
  if (input.candidate.reason === "correction") {
    if (reason === undefined || reason.length < 3 || reason.length > 500) {
      rejectScoring(
        "MATERIALIZATION_CORRECTION_REASON_REQUIRED",
        "Workbook corrections require a reason between 3 and 500 characters.",
        "correctionReason"
      );
    }
    return reason;
  }
  if (reason !== undefined && reason.length > 0) {
    rejectScoring(
      "MATERIALIZATION_CORRECTION_REASON_UNEXPECTED",
      "A non-correction workbook revision cannot carry a correction reason.",
      "correctionReason"
    );
  }
  return undefined;
}

function parseCandidateUuid<Kind extends Parameters<typeof parseStableUuid>[1]>(
  value: string,
  kind: Kind,
  issues: ReturnType<typeof scoringIssue>[]
): ReturnType<typeof parseStableUuid<Kind>> {
  if (!isStableUuid(value)) {
    issues.push(scoringIssue(
      "CANDIDATE_PARTICIPANT_LEDGER_INVALID",
      "Persisted participant ledger contains an invalid stable identity."
    ));
    return value as ReturnType<typeof parseStableUuid<Kind>>;
  }
  return parseStableUuid(value, kind);
}

function participantKey(participant: CandidateParticipant): string {
  return [
    participant.sideNumber,
    participant.teamId,
    participant.playerId,
    participant.rosterMembershipId,
    participant.rosterSlot
  ].join(":");
}

function requiredUuid(
  value: unknown,
  code: string,
  path: string,
  issues: ReturnType<typeof scoringIssue>[]
): string | undefined {
  const parsed = uuidText(value);
  if (parsed === undefined) {
    issues.push(scoringIssue(code, "Workbook candidate stable identity is invalid.", path));
  }
  return parsed;
}

function uuidText(value: unknown): string | undefined {
  return typeof value === "string" && isStableUuid(value) ? value.toLowerCase() : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function side(value: unknown): 1 | 2 | undefined {
  return value === 1 || value === 2 ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredDisplay(value: string, path: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    rejectScoring(
      "CANDIDATE_DISPLAY_SNAPSHOT_INVALID",
      "Revision display snapshots cannot be empty.",
      path
    );
  }
  return normalized;
}
