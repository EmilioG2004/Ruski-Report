/**
 * Exercises the complete guest-facing production read path and realtime
 * handshake. The check never creates, updates, or deletes server state.
 */

import { verifyRealtimeConnections } from
  "../../backend/scripts/realtime-smoke-client.mjs";
import { fileURLToPath } from "node:url";
import { loadQualificationConfiguration } from "./configuration.mjs";
import {
  QualificationHttpClient,
  requireCondition
} from "./http-client.mjs";

export async function runProductionReadQualification(environment = process.env) {
  const configuration = loadQualificationConfiguration(environment);
  const client = new QualificationHttpClient(
    configuration.apiBaseUrl,
    configuration.requestTimeoutMilliseconds
  );

  const health = await client.get("health");
  requireCondition(
    health?.status === "ok" && health?.database === "ok",
    "Production health response did not confirm API and database readiness."
  );

  const games = await client.get("games");
  requireCondition(Array.isArray(games) && games.length > 0, "No games found.");
  requireCondition(
    games.some((game) => game?.gameType === configuration.gameType),
    `Game type '${configuration.gameType}' is not available.`
  );

  const active = await client.get("tournaments/active");
  requireIdentifier(active, "active tournament");
  requireCondition(
    active.gameType === configuration.gameType,
    "Active tournament has an unexpected game type."
  );

  const tournament = await client.get(`tournaments/${active.id}`);
  requireCondition(
    tournament?.id === active.id && Array.isArray(tournament?.teams),
    "Tournament detail is incomplete."
  );
  requireCondition(
    Array.isArray(tournament?.standings) &&
      Array.isArray(tournament?.matchSummaries),
    "Tournament standings or match summaries are missing."
  );

  const matches = await client.get(`tournaments/${active.id}/matches`);
  requireCondition(Array.isArray(matches), "Tournament matches are not an array.");
  requireCondition(matches.length > 0, "Active tournament has no matches.");
  const match = matches[0];
  requireIdentifier(match, "match summary");

  const detail = await client.get(`matches/${match.id}`);
  requireCondition(
    detail?.id === match.id &&
      Array.isArray(detail?.participants) &&
      Array.isArray(detail?.events),
    "Match detail is incomplete."
  );
  const comments = await client.get(`matches/${match.id}/comments`);
  requireCondition(Array.isArray(comments), "Match comments are not an array.");

  await verifyRealtimeConnections(configuration.publicBaseUrl);
  return {
    gameCount: games.length,
    tournamentId: active.id,
    teamCount: tournament.teams.length,
    standingCount: tournament.standings.length,
    matchCount: matches.length,
    sampledCommentCount: comments.length
  };
}

function requireIdentifier(value, label) {
  requireCondition(
    typeof value?.id === "string" && value.id.length > 0,
    `The ${label} has no identifier.`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runProductionReadQualification();
  console.log("Production read qualification passed.");
  console.log(JSON.stringify(result, null, 2));
}
