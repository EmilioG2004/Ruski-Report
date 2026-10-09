import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import {
  ISODateTimeString,
  LiveUpdateEvent,
  LiveUpdateEventType,
  MatchId,
  Metadata,
  TournamentId
} from "../domain";
import {
  REALTIME_EVENT_BROADCASTER,
  RealtimeEventBroadcaster
} from "./realtime-event-broadcaster";

export interface PublishTournamentUpdatedInput {
  tournamentId: TournamentId;
  projectionVersion?: number;
  version?: number;
  occurredAt?: ISODateTimeString;
  metadata?: Metadata;
}

export interface PublishMatchUpdatedInput {
  tournamentId: TournamentId;
  matchId: MatchId;
  projectionVersion?: number;
  version?: number;
  occurredAt?: ISODateTimeString;
  metadata?: Metadata;
}

export interface PublishCommentsUpdatedInput {
  matchId: MatchId;
  tournamentId?: TournamentId;
  projectionVersion?: number;
  version?: number;
  occurredAt?: ISODateTimeString;
  metadata?: Metadata;
}

@Injectable()
export class RealtimeUpdatePublisher {
  constructor(
    @Inject(REALTIME_EVENT_BROADCASTER)
    private readonly broadcaster: RealtimeEventBroadcaster
  ) {}

  publishTournamentUpdated(
    input: PublishTournamentUpdatedInput
  ): LiveUpdateEvent {
    const version = input.version ?? input.projectionVersion;
    return this.publish({
      type: "tournament.updated",
      tournamentId: input.tournamentId,
      ...(input.projectionVersion === undefined
        ? {}
        : { projectionVersion: input.projectionVersion }),
      version,
      occurredAt: input.occurredAt,
      metadata: input.metadata
    });
  }

  publishMatchUpdated(input: PublishMatchUpdatedInput): LiveUpdateEvent {
    const version = input.version ?? input.projectionVersion;
    return this.publish({
      type: "match.updated",
      tournamentId: input.tournamentId,
      matchId: input.matchId,
      ...(input.projectionVersion === undefined
        ? {}
        : { projectionVersion: input.projectionVersion }),
      version,
      occurredAt: input.occurredAt,
      metadata: input.metadata
    });
  }

  publishCommentsUpdated(
    input: PublishCommentsUpdatedInput
  ): LiveUpdateEvent {
    const version = input.version ?? input.projectionVersion;
    return this.publish({
      type: "comments.updated",
      tournamentId: input.tournamentId,
      matchId: input.matchId,
      ...(input.projectionVersion === undefined
        ? {}
        : { projectionVersion: input.projectionVersion }),
      version,
      occurredAt: input.occurredAt,
      metadata: input.metadata
    });
  }

  private publish(
    input: Omit<LiveUpdateEvent, "id" | "occurredAt"> & {
      type: LiveUpdateEventType;
      occurredAt?: ISODateTimeString;
    }
  ): LiveUpdateEvent {
    const { occurredAt, ...eventInput } = input;
    const event: LiveUpdateEvent = {
      id: `live-${randomUUID()}`,
      occurredAt: occurredAt ?? new Date().toISOString(),
      ...eventInput
    };

    this.broadcaster.broadcast(event);
    return event;
  }
}
