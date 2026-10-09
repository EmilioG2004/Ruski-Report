/**
 * Socket.IO transport smoke check for an internal, non-TLS rehearsal network.
 * Production remains HTTPS/WSS-only; this helper deliberately accepts only an
 * http URL whose hostname is a generated Phase 7 container name.
 */

export async function verifyIsolatedRealtimeConnections(baseUrl) {
  const endpoint = createEndpoint(baseUrl);
  await verifyConnection(endpoint);
  await verifyConnection(endpoint);
  return { connectionCount: 2 };
}

export function createEndpoint(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !/^phase7-api-[a-z0-9-]{6,64}$/u.test(url.hostname) ||
    (url.port !== "" && url.port !== "3000") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Isolated realtime smoke target is not an internal Phase 7 API.");
  }
  const websocket = new URL("/socket.io/", url);
  websocket.protocol = "ws:";
  websocket.searchParams.set("EIO", "4");
  websocket.searchParams.set("transport", "websocket");
  return websocket;
}

function verifyConnection(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    let settled = false;
    const timeout = setTimeout(
      () => finish(new Error("Isolated realtime smoke timed out.")),
      15_000
    );
    socket.addEventListener("message", (event) => {
      const message = String(event.data);
      if (message.startsWith("0")) {
        socket.send("40/live,");
      } else if (message === "2") {
        socket.send("3");
      } else if (message.startsWith("44/live,")) {
        finish(new Error("Isolated realtime namespace was rejected."));
      } else if (message.startsWith("42/live,")) {
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
          finish(new Error("Isolated realtime response was malformed."));
        }
      }
    });
    socket.addEventListener("error", () =>
      finish(new Error("Isolated realtime transport failed."))
    );
    socket.addEventListener("close", () => {
      if (!settled) finish(new Error("Isolated realtime transport closed early."));
    });

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "done");
      error === undefined ? resolve() : reject(error);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await verifyIsolatedRealtimeConnections(process.argv[2]);
  process.stdout.write(`${JSON.stringify({ status: "passed", ...result })}\n`);
}
