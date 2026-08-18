/**
 * Coordinates every production-changing qualification step behind an explicit
 * opt-in and an environment-provided admin token. No secret is logged.
 */

import { loadQualificationConfiguration } from "./configuration.mjs";
import { fileURLToPath } from "node:url";
import { observeRealtimeEvent } from
  "../../backend/scripts/realtime-event-observer.mjs";
import { QualificationHttpClient } from "./http-client.mjs";
import { qualifyProductionCommunity } from "./production-community.mjs";
import { qualifyProductionPublication } from "./production-publication.mjs";
import { runProductionReadQualification } from "./production-read.mjs";

export async function runProductionWriteQualification(environment = process.env) {
  requireWriteOptIn(environment);
  const adminToken = environment.RUSKI_QUALIFICATION_ADMIN_TOKEN;
  if (adminToken === undefined || adminToken.length === 0) {
    throw new Error("RUSKI_QUALIFICATION_ADMIN_TOKEN is required.");
  }

  const configuration = loadQualificationConfiguration(environment);
  const client = new QualificationHttpClient(
    configuration.apiBaseUrl,
    configuration.requestTimeoutMilliseconds
  );
  const publish = () => observeRealtimeEvent({
    publicBaseUrl: configuration.publicBaseUrl,
    subscription: { scope: "all" },
    expectation: { type: "tournament.updated" },
    action: () => qualifyProductionPublication(client, configuration, adminToken),
    timeoutMilliseconds: configuration.realtimeEventTimeoutMilliseconds
  });
  const publication = await publish();
  const read = await runProductionReadQualification(environment);
  const community = await qualifyProductionCommunity(
    client,
    adminToken,
    configuration,
    publish
  );
  return { publication, read, community };
}

function requireWriteOptIn(environment) {
  if (environment.RUSKI_QUALIFICATION_ALLOW_WRITES !== "YES") {
    throw new Error(
      "Set RUSKI_QUALIFICATION_ALLOW_WRITES=YES to permit production changes."
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runProductionWriteQualification();
  console.log("Production write qualification passed.");
  console.log(JSON.stringify(result, null, 2));
}
