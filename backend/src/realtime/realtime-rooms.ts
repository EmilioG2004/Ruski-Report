import { LiveUpdateEvent, MatchId, TournamentId } from "../domain";

export function getRoomsForEvent(event: LiveUpdateEvent): string[] {
  return Array.from(
    new Set([
      getAllUpdatesRoom(),
      event.tournamentId === undefined
        ? undefined
        : getTournamentRoom(event.tournamentId),
      event.matchId === undefined ? undefined : getMatchRoom(event.matchId)
    ].filter(isNonEmptyString))
  );
}

export function getAllUpdatesRoom(): string {
  return "live:all";
}

export function getTournamentRoom(tournamentId: TournamentId): string {
  return `live:tournament:${tournamentId}`;
}

export function getMatchRoom(matchId: MatchId): string {
  return `live:match:${matchId}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
