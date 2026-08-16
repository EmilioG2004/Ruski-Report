import { randomUUID } from "node:crypto";

import { Inject } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";

import {
  createCorsOptions,
  loadHttpServerConfig
} from "../config/http-server.config";
import { LiveUpdateEvent, MatchId, Metadata, TournamentId } from "../domain";
import { APP_LOGGER, AppLogger } from "../logging";
import { RealtimeEventBroadcaster } from "./realtime-event-broadcaster";
import { getRoomsForEvent } from "./realtime-rooms";
import {
  normalizeSubscription,
  RealtimeSubscriptionRequest
} from "./realtime-subscription";

export const LIVE_UPDATE_EVENT_NAME = "live.update";
export const SUBSCRIBE_EVENT_NAME = "subscribe";
const realtimeCorsOptions = createCorsOptions(
  loadHttpServerConfig().allowedOrigins
);

@WebSocketGateway({
  namespace: "/live",
  cors: realtimeCorsOptions
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, RealtimeEventBroadcaster
{
  @WebSocketServer()
  private server?: Server;

  constructor(
    @Inject(APP_LOGGER)
    private readonly logger: AppLogger
  ) {}

  handleConnection(client: Socket): void {
    this.logger.info("Realtime client connected or reconnected.", {
      component: "realtime",
      operation: "connect",
      metadata: {
        clientId: client.id,
        recovered: getRecoveredState(client),
        transport: client.conn.transport.name
      }
    });

    this.emitConnectionReady(client);
  }

  handleDisconnect(client: Socket): void {
    this.logger.info("Realtime client disconnected.", {
      component: "realtime",
      operation: "disconnect",
      metadata: {
        clientId: client.id,
        transport: client.conn.transport.name
      }
    });
  }

  @SubscribeMessage(SUBSCRIBE_EVENT_NAME)
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() request: RealtimeSubscriptionRequest
  ): void {
    const subscription = normalizeSubscription(request);

    if (!subscription.ok) {
      this.emitError(client, subscription.code, subscription.message);
      return;
    }

    client.join(subscription.value.room);
    this.logger.info("Realtime client subscribed.", {
      component: "realtime",
      operation: "subscribe",
      tournamentId: subscription.value.tournamentId,
      matchId: subscription.value.matchId,
      metadata: {
        clientId: client.id,
        room: subscription.value.room,
        scope: subscription.value.scope
      }
    });

    this.emitConnectionReady(client, {
      subscription: {
        scope: subscription.value.scope,
        tournamentId: subscription.value.tournamentId,
        matchId: subscription.value.matchId
      }
    });
  }

  broadcast(event: LiveUpdateEvent): void {
    if (this.server === undefined) {
      this.logger.warning("Realtime event was not sent because no server exists.", {
        component: "realtime",
        operation: "broadcast",
        tournamentId: event.tournamentId,
        matchId: event.matchId,
        metadata: {
          eventId: event.id,
          eventType: event.type
        }
      });
      return;
    }

    const rooms = getRoomsForEvent(event);
    this.server.to(rooms).emit(LIVE_UPDATE_EVENT_NAME, event);

    this.logger.info("Realtime event published.", {
      component: "realtime",
      operation: "broadcast",
      tournamentId: event.tournamentId,
      matchId: event.matchId,
      metadata: {
        eventId: event.id,
        eventType: event.type,
        rooms
      }
    });
  }

  private emitConnectionReady(client: Socket, metadata?: Metadata): void {
    client.emit(
      LIVE_UPDATE_EVENT_NAME,
      createGatewayEvent("connection.ready", metadata)
    );
  }

  private emitError(client: Socket, code: string, message: string): void {
    client.emit(
      LIVE_UPDATE_EVENT_NAME,
      createGatewayEvent("error", {
        code,
        message
      })
    );
  }
}

function createGatewayEvent(
  type: "connection.ready" | "error",
  metadata?: Metadata
): LiveUpdateEvent {
  return {
    id: `live-${randomUUID()}`,
    type,
    occurredAt: new Date().toISOString(),
    metadata
  };
}

function getRecoveredState(client: Socket): boolean {
  return "recovered" in client && client.recovered === true;
}
