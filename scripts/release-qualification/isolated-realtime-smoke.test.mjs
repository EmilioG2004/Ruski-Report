import assert from "node:assert/strict";
import test from "node:test";

import { createEndpoint } from "./isolated-realtime-smoke.mjs";

test("maps the generated internal HTTP endpoint to Socket.IO WebSocket", () => {
  assert.equal(
    createEndpoint("http://phase7-api-a1b2c3d4:3000").href,
    "ws://phase7-api-a1b2c3d4:3000/socket.io/?EIO=4&transport=websocket"
  );
});

for (const value of [
  "https://phase7-api-a1b2c3d4:3000",
  "http://localhost:3000",
  "http://postgres:3000",
  "http://phase7-api-a1b2c3d4:3001",
  "http://phase7-api-a1b2c3d4:3000?host=postgres"
]) {
  test(`rejects non-isolated target ${value}`, () => {
    assert.throws(() => createEndpoint(value));
  });
}
