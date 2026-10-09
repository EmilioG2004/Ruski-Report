/**
 * Verifies that the production Socket.IO namespace accepts an initial WebSocket
 * connection and a clean reconnect without relying on a Socket.IO dependency.
 */

export async function verifyRealtimeConnections(publicBaseUrl) {
  const endpoint = createWebSocketEndpoint(publicBaseUrl);
  await verifyRealtimeConnection(endpoint, "initial connection");
  await verifyRealtimeConnection(endpoint, "reconnection");
}

export function createWebSocketEndpoint(value) {
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
    const timeout = setTimeout(
      () => finish(new Error(`Timed out during ${label}.`)),
      15_000
    );

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
        finish(new Error(`Socket.IO rejected ${label}.`));
        return;
      }
      if (!message.startsWith("42/live,")) {
        return;
      }

      try {
        const payload = JSON.parse(message.slice("42/live,".length));
        if (
          Array.isArray(payload) &&
          payload[0] === "live.update" &&
          payload[1]?.type === "connection.ready"
        ) {
          finish();
        }
      } catch {
        finish(new Error(`Socket.IO sent malformed JSON during ${label}.`));
      }
    });
    socket.addEventListener("error", () =>
      finish(new Error(`WebSocket error during ${label}.`))
    );
    socket.addEventListener("close", (event) => {
      if (!settled) {
        finish(
          new Error(
            `WebSocket closed during ${label} with code ${event.code}.`
          )
        );
      }
    });

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1000, "Smoke test complete");
      }
      error === undefined ? resolve() : reject(error);
    }
  });
}
