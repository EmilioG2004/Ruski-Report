import {
  BracketId,
  BracketMatchId,
  BracketRoundId,
  MatchId,
  parseStableUuid,
  TournamentId
} from "../domain";
import { createStablePlayoffMatchId } from "../scheduling";
import { createUuidV5 } from "../scheduling/uuid-v5";

const MATCH_ID_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

export function createSingleEliminationBracketId(
  tournamentId: TournamentId
): BracketId {
  return parseStableUuid(
    createUuidV5(tournamentId, "single-elimination|v1"),
    "bracket"
  );
}

export function createBracketRoundId(
  bracketId: BracketId,
  roundNumber: number
): BracketRoundId {
  requirePositiveInteger(roundNumber, "Round number");
  return parseStableUuid(
    createUuidV5(bracketId, `round|${roundNumber}`),
    "bracket_round"
  );
}

export function createBracketMatchId(
  bracketId: BracketId,
  roundNumber: number,
  position: number
): BracketMatchId {
  requirePositiveInteger(roundNumber, "Round number");
  requirePositiveInteger(position, "Match position");
  return parseStableUuid(
    createUuidV5(bracketId, `round|${roundNumber}|match|${position}`),
    "bracket_match"
  );
}

export function createBracketSlotId(
  bracketMatchId: BracketMatchId,
  slotNumber: 1 | 2
): string {
  return createUuidV5(bracketMatchId, `slot|${slotNumber}`);
}

export function createStablePlayoffMatchInstanceId(input: {
  readonly tournamentId: TournamentId;
  readonly bracketMatchId: BracketMatchId;
  readonly instanceNumber: number;
}): MatchId {
  requirePositiveInteger(input.instanceNumber, "Playoff match instance number");
  if (input.instanceNumber === 1) {
    return createStablePlayoffMatchId(input);
  }
  return parseStableUuid(
    createUuidV5(
      MATCH_ID_NAMESPACE,
      [
        "ruski-report",
        input.tournamentId,
        "playoffs",
        input.bracketMatchId,
        "replacement-instance",
        String(input.instanceNumber)
      ].join("|")
    ),
    "match"
  );
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
}
