import { MatchId, TournamentId } from "../domain";
import {
  getAllUpdatesRoom,
  getMatchRoom,
  getTournamentRoom
} from "./realtime-rooms";

export type RealtimeSubscriptionScope = "all" | "tournament" | "match";

export interface RealtimeSubscriptionRequest {
  scope?: unknown;
  tournamentId?: unknown;
  matchId?: unknown;
}

export interface NormalizedSubscription {
  scope: RealtimeSubscriptionScope;
  room: string;
  tournamentId?: TournamentId;
  matchId?: MatchId;
}

export type SubscriptionResult =
  | {
      ok: true;
      value: NormalizedSubscription;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

export function normalizeSubscription(
  request: RealtimeSubscriptionRequest
): SubscriptionResult {
  if (!isObjectRecord(request)) {
    return invalidSubscription("SUBSCRIPTION_INVALID", "Subscription is invalid.");
  }

  const scope = normalizeScope(request);

  if (scope === "all") {
    return {
      ok: true,
      value: {
        scope,
        room: getAllUpdatesRoom()
      }
    };
  }

  if (scope === "tournament") {
    if (!isNonEmptyString(request.tournamentId)) {
      return invalidSubscription(
        "TOURNAMENT_ID_REQUIRED",
        "A tournament subscription requires tournamentId."
      );
    }

    return {
      ok: true,
      value: {
        scope,
        room: getTournamentRoom(request.tournamentId),
        tournamentId: request.tournamentId
      }
    };
  }

  if (!isNonEmptyString(request.matchId)) {
    return invalidSubscription(
      "MATCH_ID_REQUIRED",
      "A match subscription requires matchId."
    );
  }

  return {
    ok: true,
    value: {
      scope,
      room: getMatchRoom(request.matchId),
      tournamentId: isNonEmptyString(request.tournamentId)
        ? request.tournamentId
        : undefined,
      matchId: request.matchId
    }
  };
}

function normalizeScope(
  request: RealtimeSubscriptionRequest
): RealtimeSubscriptionScope {
  if (
    request.scope === "all" ||
    request.scope === "tournament" ||
    request.scope === "match"
  ) {
    return request.scope;
  }

  if (isNonEmptyString(request.matchId)) {
    return "match";
  }

  if (isNonEmptyString(request.tournamentId)) {
    return "tournament";
  }

  return "all";
}

function invalidSubscription(
  code: string,
  message: string
): SubscriptionResult {
  return {
    ok: false,
    code,
    message
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
