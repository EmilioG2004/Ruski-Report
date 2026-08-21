import { CanonicalWorkbookGenerationInput } from "./types";
import { CANONICAL_WORKBOOK_LIMITS } from "../schema";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const GENERATABLE_LIFECYCLES = new Set([
  "setup_published",
  "pod_play",
  "seeding_review",
  "playoffs",
  "completed"
]);

export class CanonicalWorkbookGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalWorkbookGenerationError";
  }
}

export function validateGenerationInput(
  input: CanonicalWorkbookGenerationInput
): void {
  if (input.matches.length + 3 > CANONICAL_WORKBOOK_LIMITS.maximumWorksheetCount) {
    invalid("Generated workbook would exceed the supported worksheet limit.");
  }
  requireUuid(input.generation.id, "generation ID");
  requirePositiveInteger(input.generation.revision, "generation revision");
  if (!SHA256_PATTERN.test(input.generation.sourceDigest)) {
    invalid("Generation source digest must be a lowercase SHA-256 digest.");
  }
  if (!isIsoDateTime(input.generation.generatedAt)) {
    invalid("Generation timestamp must be an ISO-8601 date-time.");
  }

  requireUuid(input.tournament.id, "tournament ID");
  requireText(input.tournament.name, "Tournament name");
  if (!Number.isInteger(input.tournament.year) ||
      input.tournament.year < 2000 || input.tournament.year > 2100) {
    invalid("Tournament year must be between 2000 and 2100.");
  }
  if (!GENERATABLE_LIFECYCLES.has(input.tournament.lifecycle)) {
    invalid("A workbook can be generated only for a published tournament.");
  }
  if (input.pods.length === 0 || input.teams.length === 0) {
    invalid("A published workbook requires at least one pod and one team.");
  }

  const podIds = new Set<string>();
  const podSequences = new Set<number>();
  for (const pod of input.pods) {
    requireUuid(pod.id, "pod ID");
    requireText(pod.name, "Pod name");
    requirePositiveInteger(pod.sequence, "pod sequence");
    requireUnique(podIds, pod.id, "pod ID");
    requireUnique(podSequences, pod.sequence, "pod sequence");
  }

  const teamIds = new Set<string>();
  const teamSequences = new Set<number>();
  const playerIds = new Set<string>();
  const membershipIds = new Set<string>();
  const teamPod = new Map<string, string>();
  const playersPerTeam = input.teams[0].players.length;
  for (const team of input.teams) {
    requireUuid(team.id, "team ID");
    requireText(team.name, "Team name");
    requirePositiveInteger(team.sequence, "team sequence");
    requirePositiveInteger(team.initialSeed, "initial pod seed");
    requireUnique(teamIds, team.id, "team ID");
    requireUnique(teamSequences, team.sequence, "team sequence");
    if (!podIds.has(team.podId)) {
      invalid(`Team '${team.id}' references an unknown pod.`);
    }
    if (team.players.length < 1 || team.players.length > 8) {
      invalid(`Team '${team.id}' must have between one and eight scorecard players.`);
    }
    if (team.players.length !== playersPerTeam) {
      invalid("Every team must have the same number of scorecard players.");
    }
    teamPod.set(team.id, team.podId);

    const rosterSlots = new Set<number>();
    for (const player of team.players) {
      requireUuid(player.id, "player ID");
      requireUuid(player.rosterMembershipId, "roster membership ID");
      requireText(player.displayName, "Player display name");
      requirePositiveInteger(player.rosterSlot, "roster slot");
      requireUnique(playerIds, player.id, "player ID");
      requireUnique(
        membershipIds,
        player.rosterMembershipId,
        "roster membership ID"
      );
      requireUnique(rosterSlots, player.rosterSlot, "team roster slot");
    }
    for (let slot = 1; slot <= team.players.length; slot += 1) {
      if (!rosterSlots.has(slot)) {
        invalid(`Team '${team.id}' roster slots must be contiguous from 1.`);
      }
    }
  }

  const matchIds = new Set<string>();
  const matchSequences = new Set<number>();
  const bracketMatchIds = new Set<string>();
  const playoffRoundPositions = new Set<string>();
  for (const match of input.matches) {
    requireUuid(match.id, "match ID");
    requireUnique(matchIds, match.id, "match ID");
    requirePositiveInteger(match.sequence, "match sequence");
    requireUnique(matchSequences, match.sequence, "match sequence");
    requirePositiveInteger(match.roundNumber, "round number");
    const [firstTeamId, secondTeamId] = match.participantTeamIds;
    if (firstTeamId === secondTeamId) {
      invalid(`Match '${match.id}' must contain two distinct teams.`);
    }
    if (!teamIds.has(firstTeamId) || !teamIds.has(secondTeamId)) {
      invalid(`Match '${match.id}' references an unknown participant team.`);
    }
    if (match.stage === "pod_play") {
      requirePositiveInteger(match.sequenceInPod, "pod match sequence");
      requirePositiveInteger(match.gameNumberForPair, "game number for pair");
      if (!podIds.has(match.podId)) {
        invalid(`Match '${match.id}' references an unknown pod.`);
      }
      if (teamPod.get(firstTeamId) !== match.podId ||
          teamPod.get(secondTeamId) !== match.podId) {
        invalid(`Match '${match.id}' participants must belong to its pod.`);
      }
    } else {
      requireUuid(match.bracketMatchId, "bracket match ID");
      requireUnique(bracketMatchIds, match.bracketMatchId, "bracket match ID");
      requirePositiveInteger(match.sequenceInRound, "playoff round match sequence");
      const roundPosition = `${match.roundNumber}:${match.sequenceInRound}`;
      requireUnique(
        playoffRoundPositions,
        roundPosition,
        "playoff round match sequence"
      );
    }
    validateMatchParticipantRosters(match, playersPerTeam);
    validateScorecardSource(match, playersPerTeam);
  }
}

function validateScorecardSource(
  match: CanonicalWorkbookGenerationInput["matches"][number],
  playersPerTeam: number
): void {
  const source = match.scorecardSource;
  if (source === undefined) return;
  if (source.status !== "LIVE GAME" && source.status !== "FINAL") {
    invalid(`Match '${match.id}' source scorecard status is invalid.`);
  }
  const rosters = match.participantRosters;
  if (rosters === undefined) {
    invalid(`Match '${match.id}' source scorecard requires frozen participants.`);
  }
  const seen = new Set<string>();
  source.rows.forEach((row) => {
    if (row.sideNumber !== 1 && row.sideNumber !== 2) {
      invalid(`Match '${match.id}' source scorecard side is invalid.`);
    }
    if (!Number.isSafeInteger(row.worksheetRow) ||
        row.worksheetRow < 10 || row.worksheetRow > 89) {
      invalid(`Match '${match.id}' source scorecard row is invalid.`);
    }
    const key = `${row.sideNumber}:${row.worksheetRow}`;
    requireUnique(seen, key, "source scorecard row");
    const expectedSlot = ((row.worksheetRow - 10) % playersPerTeam) + 1;
    const player = rosters[row.sideNumber - 1].players.find(
      (candidate) => candidate.rosterSlot === expectedSlot
    );
    if (player === undefined || row.rosterSlot !== expectedSlot ||
        row.playerId !== player.id ||
        row.rosterMembershipId !== player.rosterMembershipId) {
      invalid(`Match '${match.id}' source scorecard participant is invalid.`);
    }
    const expectedShot = Math.floor((row.worksheetRow - 10) / playersPerTeam) + 1;
    if (row.shotNumber !== expectedShot) {
      invalid(`Match '${match.id}' source scorecard shot number is invalid.`);
    }
    const markerValues = Object.values(row.markers);
    if (markerValues.length !== 7 || markerValues.some((value) => typeof value !== "boolean")) {
      invalid(`Match '${match.id}' source scorecard markers are invalid.`);
    }
  });
}

function validateMatchParticipantRosters(
  match: CanonicalWorkbookGenerationInput["matches"][number],
  playersPerTeam: number
): void {
  if (match.participantRosters === undefined) {
    return;
  }
  const matchPlayerIds = new Set<string>();
  const matchMembershipIds = new Set<string>();
  match.participantRosters.forEach((roster, sideIndex) => {
    if (roster.teamId !== match.participantTeamIds[sideIndex]) {
      invalid(
        `Match '${match.id}' frozen roster team must match participant side ${sideIndex + 1}.`
      );
    }
    if (roster.players.length !== playersPerTeam) {
      invalid(
        `Match '${match.id}' frozen rosters must contain exactly ${playersPerTeam} players per team.`
      );
    }
    const rosterSlots = new Set<number>();
    for (const player of roster.players) {
      requireUuid(player.id, "frozen participant player ID");
      requireUuid(
        player.rosterMembershipId,
        "frozen participant roster membership ID"
      );
      requireText(player.displayName, "Frozen participant display name");
      requirePositiveInteger(player.rosterSlot, "frozen participant roster slot");
      requireUnique(matchPlayerIds, player.id, "frozen participant player ID");
      requireUnique(
        matchMembershipIds,
        player.rosterMembershipId,
        "frozen participant roster membership ID"
      );
      requireUnique(rosterSlots, player.rosterSlot, "frozen team roster slot");
    }
    for (let slot = 1; slot <= playersPerTeam; slot += 1) {
      if (!rosterSlots.has(slot)) {
        invalid(
          `Match '${match.id}' frozen roster slots must be contiguous from 1.`
        );
      }
    }
  });
}

function requireUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)) {
    invalid(`${label} must be a non-nil UUID.`);
  }
}

function requireText(value: string, label: string): void {
  if (value.trim().length === 0) {
    invalid(`${label} cannot be blank.`);
  }
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    invalid(`${label} must be a positive integer.`);
  }
}

function requireUnique<T>(values: Set<T>, value: T, label: string): void {
  if (values.has(value)) {
    invalid(`Duplicate ${label} '${String(value)}'.`);
  }
  values.add(value);
}

function isIsoDateTime(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function invalid(message: string): never {
  throw new CanonicalWorkbookGenerationError(message);
}
