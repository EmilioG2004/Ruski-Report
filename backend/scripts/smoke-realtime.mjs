#!/usr/bin/env node

const publicBaseUrl = process.argv[2];

if (publicBaseUrl === undefined) {
  console.error(
    "Usage: npm run smoke:realtime -- https://api.ruskireport.com"
  );
  process.exit(2);
}

const endpoint = createWebSocketEndpoint(publicBaseUrl);

await verifyRealtimeConnection(endpoint, "initial connection");
await verifyRealtimeConnection(endpoint, "reconnection");
console.log("Realtime WSS connection and reconnection succeeded.");

function createWebSocketEndpoint(value) {
  const publicUrl = new URL(value);

  if (publicUrl.protocol !== "https:") {
    throw new Error("The production smoke test requires an HTTPS base URL.");
  }

  const websocketUrl = new URL("/socket.io/", publicUrl);
  websocketUrl.protocol = "wss:";
  websocketUrl.searchParams.set("EIO", "4");
  websocketUrl.searchParams.set("transport", "websocket");
  return websocketUrl;
}

function verifyRealtimeConnection(endpointUrl, label) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpointUrl);
    let settled = false;
    const timeout = setTimeout(() => {
      finish(new Error(`Timed out during ${label}.`));
    }, 15_000);

    socket.addEventListener("message", (event) => {
      const message = String(event.data);

      if (message.startsWith("0")) {
        socket.send("40/live,");
        return;
      }

      if (message === "2") {
        socket.send("3");
        return;
      }

      if (message.startsWith("44/live,")) {
        finish(new Error(`Socket.IO rejected ${label}: ${message}`));
        return;
      }

      const eventPrefix = "42/live,";
      if (!message.startsWith(eventPrefix)) {
        return;
      }

      const payload = JSON.parse(message.slice(eventPrefix.length));
      if (
        Array.isArray(payload) &&
        payload[0] === "live.update" &&
        payload[1]?.type === "connection.ready"
      ) {
        finish();
      }
    });

    socket.addEventListener("error", () => {
      finish(new Error(`WebSocket error during ${label}.`));
    });

    socket.addEventListener("close", (event) => {
      if (!settled) {
        finish(
          new Error(
            `WebSocket closed before ${label} completed (code ${event.code}).`
          )
        );
      }
    });

    function finish(error) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1000, "Smoke test complete");
      }

      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    }
  });
}
