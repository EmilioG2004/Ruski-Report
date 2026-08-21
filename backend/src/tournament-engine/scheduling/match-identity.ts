import {
  BracketMatchId,
  MatchId,
  parseStableUuid,
  PodId,
  TournamentId,
  TournamentTeamId
} from "../domain/ids";
import { createUuidV5 } from "./uuid-v5";

const MATCH_ID_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

export interface StablePodMatchIdentityInput {
  readonly tournamentId: TournamentId;
  readonly podId: PodId;
  readonly participantTeamIds: readonly [
    TournamentTeamId,
    TournamentTeamId
  ];
  readonly gameNumberForPair: number;
}

export interface StablePlayoffMatchIdentityInput {
  readonly tournamentId: TournamentId;
  readonly bracketMatchId: BracketMatchId;
}

export function createStablePodMatchId(
  input: StablePodMatchIdentityInput
): MatchId {
  if (!Number.isInteger(input.gameNumberForPair) ||
      input.gameNumberForPair < 1) {
    throw new Error("Game number for a pod pairing must be positive.");
  }

  const participantIds = [...input.participantTeamIds].sort();
  if (participantIds[0] === participantIds[1]) {
    throw new Error("A pod match requires two distinct teams.");
  }

  return matchId([
    "ruski-report",
    input.tournamentId,
    "pod_play",
    input.podId,
    participantIds.join(":"),
    String(input.gameNumberForPair)
  ]);
}

export function createStablePlayoffMatchId(
  input: StablePlayoffMatchIdentityInput
): MatchId {
  return matchId([
    "ruski-report",
    input.tournamentId,
    "playoffs",
    input.bracketMatchId
  ]);
}

function matchId(identityParts: readonly string[]): MatchId {
  return parseStableUuid(
    createUuidV5(MATCH_ID_NAMESPACE, identityParts.join("|")),
    "match"
  );
}
