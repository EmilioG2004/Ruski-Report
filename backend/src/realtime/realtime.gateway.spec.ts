import { Server, Socket } from "socket.io";

import { AppLogger } from "../logging";
import {
  LIVE_UPDATE_EVENT_NAME,
  RealtimeGateway
} from "./realtime.gateway";

describe("RealtimeGateway", () => {
  it("emits readiness and logs connection lifecycle events", () => {
    const logger = createLogger();
    const gateway = new RealtimeGateway(logger);
    const client = createClient();

    gateway.handleConnection(client.socket);
    gateway.handleDisconnect(client.socket);

    expect(client.emit).toHaveBeenCalledWith(
      LIVE_UPDATE_EVENT_NAME,
      expect.objectContaining({
        id: expect.stringMatching(/^live-/),
        type: "connection.ready"
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Realtime client connected or reconnected.",
      expect.objectContaining({
        component: "realtime",
        operation: "connect"
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Realtime client disconnected.",
      expect.objectContaining({
        component: "realtime",
        operation: "disconnect"
      })
    );
  });

  it("subscribes clients to match rooms and acknowledges the subscription", () => {
    const logger = createLogger();
    const gateway = new RealtimeGateway(logger);
    const client = createClient();

    gateway.handleSubscribe(client.socket, {
      scope: "match",
      tournamentId: "tournament-2026",
      matchId: "match-1"
    });

    expect(client.join).toHaveBeenCalledWith("live:match:match-1");
    expect(client.emit).toHaveBeenCalledWith(
      LIVE_UPDATE_EVENT_NAME,
      expect.objectContaining({
        type: "connection.ready",
        metadata: {
          subscription: {
            scope: "match",
            tournamentId: "tournament-2026",
            matchId: "match-1"
          }
        }
      })
    );
  });

  it("broadcasts events to all relevant rooms", () => {
    const logger = createLogger();
    const gateway = new RealtimeGateway(logger);
    const server = createServer();
    const event = {
      id: "live-1",
      type: "match.updated" as const,
      occurredAt: "2026-06-21T12:00:00.000Z",
      tournamentId: "tournament-2026",
      matchId: "match-1",
      version: 3
    };

    Reflect.set(gateway, "server", server.server);
    gateway.broadcast(event);

    expect(server.to).toHaveBeenCalledWith([
      "live:all",
      "live:tournament:tournament-2026",
      "live:match:match-1"
    ]);
    expect(server.emit).toHaveBeenCalledWith(LIVE_UPDATE_EVENT_NAME, event);
  });
});

function createLogger(): jest.Mocked<AppLogger> {
  return {
    debug: jest.fn<void, Parameters<AppLogger["debug"]>>(),
    info: jest.fn<void, Parameters<AppLogger["info"]>>(),
    warning: jest.fn<void, Parameters<AppLogger["warning"]>>(),
    error: jest.fn<void, Parameters<AppLogger["error"]>>()
  };
}

function createClient(): {
  socket: Socket;
  emit: jest.Mock;
  join: jest.Mock;
} {
  const emit = jest.fn();
  const join = jest.fn();

  return {
    socket: {
      id: "socket-1",
      conn: {
        transport: {
          name: "websocket"
        }
      },
      emit,
      join
    } as unknown as Socket,
    emit,
    join
  };
}

function createServer(): {
  server: Server;
  to: jest.Mock;
  emit: jest.Mock;
} {
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({
    emit
  });

  return {
    server: {
      to
    } as unknown as Server,
    to,
    emit
  };
}
