/**
 * Subscribes before a production mutation, then completes only when both the
 * mutation and its matching live update succeed. Events may arrive first.
 */

import { createWebSocketEndpoint } from "./realtime-smoke-client.mjs";

export function observeRealtimeEvent({
  publicBaseUrl,
  subscription,
  expectation,
  action,
  timeoutMilliseconds,
  webSocketFactory = (url) => new WebSocket(url)
}) {
  return new Promise((resolve, reject) => {
    const socket = webSocketFactory(createWebSocketEndpoint(publicBaseUrl));
    let settled = false;
    let actionStarted = false;
    let actionCompleted = false;
    let eventReceived = false;
    let actionResult;
    const timeout = setTimeout(
      () => finish(new Error(`Timed out waiting for ${expectation.type}.`)),
      timeoutMilliseconds
    );

    socket.addEventListener("message", (message) => {
      const frame = String(message.data);
      if (frame.startsWith("0")) {
        socket.send("40/live,");
        return;
      }
      if (frame === "2") {
        socket.send("3");
        return;
      }
      if (!frame.startsWith("42/live,")) return;

      let payload;
      try {
        payload = JSON.parse(frame.slice("42/live,".length));
      } catch {
        finish(new Error("Realtime observer received malformed JSON."));
        return;
      }
      const event = payload?.[0] === "live.update" ? payload[1] : undefined;
      if (event?.type === "error") {
        finish(new Error("Realtime subscription was rejected."));
      } else if (isSubscriptionReady(event, subscription)) {
        startAction();
      } else if (matchesExpectation(event, expectation)) {
        eventReceived = true;
        completeIfReady();
      } else if (event?.type === "connection.ready" && !actionStarted) {
        socket.send(`42/live,${JSON.stringify(["subscribe", subscription])}`);
      }
    });
    socket.addEventListener("error", () =>
      finish(new Error("Realtime observer WebSocket failed."))
    );
    socket.addEventListener("close", (event) => {
      if (!settled) {
        finish(new Error(`Realtime observer closed with code ${event.code}.`));
      }
    });

    function startAction() {
      if (actionStarted) return;
      actionStarted = true;
      Promise.resolve()
        .then(action)
        .then((result) => {
          actionResult = result;
          actionCompleted = true;
          completeIfReady();
        })
        .catch(finish);
    }

    function completeIfReady() {
      if (actionCompleted && eventReceived) finish(undefined, actionResult);
    }

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (socket.readyState === 1) {
        socket.close(1000, "Qualification complete");
      }
      error === undefined ? resolve(result) : reject(error);
    }
  });
}

function isSubscriptionReady(event, subscription) {
  const acknowledged = event?.metadata?.subscription;
  return (
    event?.type === "connection.ready" &&
    acknowledged?.scope === subscription.scope &&
    acknowledged?.tournamentId === subscription.tournamentId &&
    acknowledged?.matchId === subscription.matchId
  );
}

function matchesExpectation(event, expectation) {
  return (
    event?.type === expectation.type &&
    (expectation.tournamentId === undefined ||
      event.tournamentId === expectation.tournamentId) &&
    (expectation.matchId === undefined || event.matchId === expectation.matchId)
  );
}
