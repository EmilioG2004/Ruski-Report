import {
  CanonicalMatchDetailEnvelope,
  CanonicalMatchListEnvelope,
  CanonicalPublicMatch,
  CanonicalPublicMatchSummary,
  CanonicalPublicProjectionRef,
  CanonicalPublicTournament,
  CanonicalTournamentDetailEnvelope,
  CanonicalTournamentDiscoveryItem,
  PublicMatchStatus,
  PublicScoreAvailability,
  PUBLIC_PROJECTION_CONTRACT_VERSION
} from "../../tournament-engine/public-projection";

export const V2_TOURNAMENT_ID = "summer-classic-2027";
export const V2_PROJECTION: CanonicalPublicProjectionRef = {
  tournamentId: V2_TOURNAMENT_ID,
  version: 4,
  activatedAt: "2027-06-01T12:00:00.000Z",
  source: "canonical"
};

export function createPublicMatch(
  id: string,
  status: PublicMatchStatus = "final",
  scoreAvailability: PublicScoreAvailability = "complete"
): CanonicalPublicMatch {
  const hasScore = scoreAvailability === "complete" || scoreAvailability === "partial";
  return {
    id,
    stage: "pod_play",
    sequence: 1,
    podId: "pod-a",
    bracketMatchId: null,
    instance: 1,
    revision: status === "scheduled" || status === "postponed" ? null : 1,
    status,
    scoreAvailability,
    correction: {
      isCorrection: false,
      reason: null,
      previousRevision: null,
      replacesMatchId: null,
      replacedByMatchId: null
    },
    timestamps: {
      scheduledAt: null,
      startedAt: status === "scheduled" || status === "postponed"
        ? null
        : "2027-06-01T12:00:00.000Z",
      endedAt: status === "final" || status === "forfeited" || status === "cancelled"
        ? "2027-06-01T12:15:00.000Z"
        : null,
      updatedAt: "2027-06-01T12:15:00.000Z"
    },
    participants: [
      {
        side: 1,
        role: "home",
        team: { id: "team-red", name: "Red Rockets" },
        players: [
          { id: "player-red-1", displayName: "Red One", rosterSlot: 1 },
          { id: "player-red-2", displayName: "Red Two", rosterSlot: 2 }
        ],
        seed: 1,
        score: hasScore ? 6 : null,
        result: status === "cancelled" ? "cancelled" : status === "final" ? "win" : null
      },
      {
        side: 2,
        role: "away",
        team: { id: "team-blue", name: "Blue Barracudas" },
        players: [
          { id: "player-blue-1", displayName: "Blue One", rosterSlot: 1 },
          { id: "player-blue-2", displayName: "Blue Two", rosterSlot: 2 }
        ],
        seed: 2,
        score: hasScore ? 4 : null,
        result: status === "cancelled" ? "cancelled" : status === "final" ? "loss" : null
      }
    ],
    winner: status === "final" ? { id: "team-red", name: "Red Rockets" } : null,
    events: [],
    statistics: [],
    boxScore: scoreAvailability === "unrecorded" ? null : {
      columns: [],
      rows: [],
      totals: {}
    },
    scorecard: scoreAvailability === "unrecorded" ? null : {
      columns: [],
      rows: []
    }
  };
}

export function createTournament(
  matches: readonly CanonicalPublicMatchSummary[] = [createPublicMatch("match-1")]
): CanonicalPublicTournament {
  return {
    id: V2_TOURNAMENT_ID,
    gameType: "ruski",
    year: 2027,
    name: "Summer Classic",
    lifecycle: "pod_play",
    format: {
      formatVersion: 1,
      formatType: "pod_and_single_elimination",
      teamCount: 2,
      podCount: 1,
      podSizes: [2],
      playersPerTeam: 2,
      gamesPerPair: 1,
      qualifiersPerPod: 2,
      bracketSize: 2,
      allowByes: false,
      standingsRules: [
        "record",
        "cupDifferential",
        "teamShootingPercentage",
        "administratorResolution"
      ]
    },
    rosters: [],
    pods: [],
    seeds: [],
    statistics: [],
    matches,
    bracket: null
  };
}

export function tournamentEnvelope(
  tournament: CanonicalPublicTournament = createTournament(),
  projection: CanonicalPublicProjectionRef = V2_PROJECTION
): CanonicalTournamentDetailEnvelope {
  return {
    contractVersion: PUBLIC_PROJECTION_CONTRACT_VERSION,
    projection,
    tournament
  };
}

export function matchListEnvelope(
  matches: readonly CanonicalPublicMatchSummary[] = [createPublicMatch("match-1")],
  projection: CanonicalPublicProjectionRef = V2_PROJECTION
): CanonicalMatchListEnvelope {
  return {
    contractVersion: PUBLIC_PROJECTION_CONTRACT_VERSION,
    projection,
    matches
  };
}

export function matchEnvelope(
  match: CanonicalPublicMatch = createPublicMatch("match-1"),
  projection: CanonicalPublicProjectionRef = V2_PROJECTION
): CanonicalMatchDetailEnvelope {
  return {
    contractVersion: PUBLIC_PROJECTION_CONTRACT_VERSION,
    projection,
    match
  };
}

export function discoveryItem(
  tournament: CanonicalPublicTournament = createTournament(),
  projection: CanonicalPublicProjectionRef = V2_PROJECTION
): CanonicalTournamentDiscoveryItem {
  return {
    projection,
    tournament: {
      id: tournament.id,
      gameType: tournament.gameType,
      year: tournament.year,
      name: tournament.name,
      lifecycle: tournament.lifecycle
    }
  };
}
