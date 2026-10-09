#!/usr/bin/env node

/** Runs the reusable realtime qualification check as a standalone CLI. */

import { verifyRealtimeConnections } from "./realtime-smoke-client.mjs";

const publicBaseUrl = process.argv[2];
if (publicBaseUrl === undefined) {
  console.error("Usage: npm run smoke:realtime -- https://api.ruskireport.com");
  process.exit(2);
}

await verifyRealtimeConnections(publicBaseUrl);
console.log("Realtime WSS connection and reconnection succeeded.");
