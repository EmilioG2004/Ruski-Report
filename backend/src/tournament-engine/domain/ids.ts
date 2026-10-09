declare const stableUuidBrand: unique symbol;

export type StableUuid<Kind extends StableUuidKind> = string & {
  readonly [stableUuidBrand]: Kind;
};

export type StableUuidKind =
  | "tournament"
  | "tournament_team"
  | "tournament_player"
  | "roster_membership"
  | "pod"
  | "match"
  | "match_revision"
  | "scoring_event"
  | "bracket"
  | "bracket_round"
  | "bracket_match";

export type TournamentId = StableUuid<"tournament">;
export type TournamentTeamId = StableUuid<"tournament_team">;
export type TournamentPlayerId = StableUuid<"tournament_player">;
export type RosterMembershipId = StableUuid<"roster_membership">;
export type PodId = StableUuid<"pod">;
export type MatchId = StableUuid<"match">;
export type MatchRevisionId = StableUuid<"match_revision">;
export type ScoringEventId = StableUuid<"scoring_event">;
export type BracketId = StableUuid<"bracket">;
export type BracketRoundId = StableUuid<"bracket_round">;
export type BracketMatchId = StableUuid<"bracket_match">;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export function isStableUuid(value: string): boolean {
  return value !== NIL_UUID && UUID_PATTERN.test(value);
}

export function parseStableUuid<Kind extends StableUuidKind>(
  value: string,
  kind: Kind
): StableUuid<Kind> {
  if (!isStableUuid(value)) {
    throw new Error(`Invalid ${kind} UUID '${value}'.`);
  }

  return value.toLowerCase() as StableUuid<Kind>;
}
