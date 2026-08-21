import {
  ISODateTimeString,
  LiveUpdateEventId,
  MatchId,
  Metadata,
  TournamentId
} from "./common";

export type LiveUpdateEventType =
  | "tournament.updated"
  | "match.updated"
  | "comments.updated"
  | "connection.ready"
  | "error";

export interface LiveUpdateEvent {
  id: LiveUpdateEventId;
  type: LiveUpdateEventType;
  occurredAt: ISODateTimeString;
  tournamentId?: TournamentId;
  matchId?: MatchId;
  projectionVersion?: number;
  version?: number;
  metadata?: Metadata;
}
