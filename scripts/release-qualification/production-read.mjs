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
import { comparePublicContracts } from "./public-equivalence.mjs";

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

  const legacyMatchDetails = await Promise.all(matches.map((item) =>
    client.get(`matches/${item.id}`)
  ));
  const detail = legacyMatchDetails[0];
  requireCondition(
    detail?.id === match.id &&
      Array.isArray(detail?.participants) &&
      Array.isArray(detail?.events),
    "Match detail is incomplete."
  );
  const comments = await client.get(`matches/${match.id}/comments`);
  requireCondition(Array.isArray(comments), "Match comments are not an array.");

  const [v2Active, v2History] = await Promise.all([
    client.get("v2/tournaments"),
    client.get("v2/tournaments/history")
  ]);
  requireV2Envelope(v2Active, "active tournament discovery");
  requireV2Envelope(v2History, "tournament history discovery");
  const discovery = [...v2Active.tournaments, ...v2History.tournaments];
  const v2Item = discovery.find((item) => item?.tournament?.id === active.id);
  requireCondition(
    v2Item !== undefined,
    "The legacy tournament is absent from canonical discovery."
  );
  const projectionVersion = v2Item.projection?.version;
  requireCondition(
    Number.isSafeInteger(projectionVersion) && projectionVersion > 0,
    "Canonical discovery has no valid projection version."
  );
  const versionQuery = `?projectionVersion=${projectionVersion}`;
  const v2Tournament = await client.get(
    `v2/tournaments/${active.id}${versionQuery}`
  );
  const v2Matches = await client.get(
    `v2/tournaments/${active.id}/matches${versionQuery}`
  );
  requireCanonicalEnvelope(v2Tournament, projectionVersion, "tournament detail");
  requireCanonicalEnvelope(v2Matches, projectionVersion, "match list");
  requireCondition(
    Array.isArray(v2Matches.matches) && v2Matches.matches.length > 0,
    "Canonical tournament has no matches."
  );
  const v2MatchEnvelopes = await Promise.all(v2Matches.matches.map((item) =>
    client.get(`v2/matches/${item.id}${versionQuery}`)
  ));
  for (const envelope of v2MatchEnvelopes) {
    requireCanonicalEnvelope(envelope, projectionVersion, "match detail");
  }
  const v2Match = v2MatchEnvelopes[0];
  requireCondition(
    v2Match.match?.id === v2Matches.matches[0].id,
    "Canonical match detail is incomplete."
  );

  const equivalence = comparePublicContracts({
    legacyTournament: tournament,
    legacyMatches: matches,
    legacyMatchDetails,
    canonicalTournament: v2Tournament.tournament,
    canonicalMatches: v2Matches.matches,
    canonicalMatchDetails: v2MatchEnvelopes.map((envelope) => envelope.match)
  });
  requireCondition(
    equivalence.equivalent,
    `V1_V2_EQUIVALENCE_FAILED:${equivalence.mismatches
      .map((mismatch) => mismatch.code).join(",")}`
  );

  await verifyRealtimeConnections(configuration.publicBaseUrl);
  return {
    gameCount: games.length,
    teamCount: tournament.teams.length,
    standingCount: tournament.standings.length,
    legacyMatchCount: matches.length,
    canonicalMatchCount: v2Matches.matches.length,
    sampledCommentCount: comments.length,
    canonicalProjectionVersion: projectionVersion,
    v1V2Equivalent: true
  };
}

function requireV2Envelope(value, label) {
  requireCondition(
    value?.contractVersion === 2 && Array.isArray(value?.tournaments),
    `Canonical ${label} is incomplete.`
  );
}

function requireCanonicalEnvelope(value, version, label) {
  requireCondition(
    value?.contractVersion === 2 &&
      value?.projection?.version === version &&
      value?.projection?.source === "canonical",
    `Canonical ${label} is not pinned to the requested projection.`
  );
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
