/** Verifies subscription ordering and event/action race handling in isolation. */

import assert from "node:assert/strict";
import test from "node:test";

import { observeRealtimeEvent } from "./realtime-event-observer.mjs";

test("waits for subscription, action, and matching event", async () => {
  const socket = new FakeWebSocket();
  let completeAction;
  const observed = observeRealtimeEvent({
    publicBaseUrl: "https://example.com",
    subscription: { scope: "match", tournamentId: "t-1", matchId: "m-1" },
    expectation: {
      type: "comments.updated",
      tournamentId: "t-1",
      matchId: "m-1"
    },
    action: () => new Promise((resolve) => {
      completeAction = resolve;
    }),
    timeoutMilliseconds: 1_000,
    webSocketFactory: () => socket
  });

  socket.message("0{\"sid\":\"engine\"}");
  assert.equal(socket.sent[0], "40/live,");
  socket.event({ type: "connection.ready" });
  assert.match(socket.sent[1], /"subscribe"/u);
  socket.event({
    type: "connection.ready",
    metadata: {
      subscription: { scope: "match", tournamentId: "t-1", matchId: "m-1" }
    }
  });
  await Promise.resolve();
  socket.event({
    type: "comments.updated",
    tournamentId: "t-1",
    matchId: "m-1"
  });
  completeAction("mutation-result");

  assert.equal(await observed, "mutation-result");
  assert.equal(socket.closeCode, 1000);
});

class FakeWebSocket {
  listeners = new Map();
  sent = [];
  readyState = 1;

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  send(value) {
    this.sent.push(value);
  }

  close(code) {
    this.closeCode = code;
    this.readyState = 3;
  }

  message(data) {
    this.listeners.get("message")?.({ data });
  }

  event(event) {
    this.message(`42/live,${JSON.stringify(["live.update", event])}`);
  }
}
