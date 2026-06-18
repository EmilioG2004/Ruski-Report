import { MatchDetail, MatchSummary, Tournament } from "../domain";
import { ruskiScorecardDefinition } from "./ruski-game-definition";

const updatedAt = "2026-06-17T12:00:00.000Z";

export const sampleMatchSummary: MatchSummary = {
  id: "match-2026-001",
  tournamentId: "tournament-2026",
  gameType: "ruski",
  status: "in_progress",
  participants: [
    {
      teamId: "team-alpha",
      role: "higher_seed",
      seed: 1,
      playerIds: ["player-alex", "player-sam"],
      score: 3,
      result: "pending"
    },
    {
      teamId: "team-blue",
      role: "lower_seed",
      seed: 2,
      playerIds: ["player-jordan", "player-casey"],
      score: 2,
      result: "pending"
    }
  ],
  score: {
    participants: [
      {
        teamId: "team-alpha",
        score: 3
      },
      {
        teamId: "team-blue",
        score: 2
      }
    ],
    isFinal: false
  },
  podId: "pod-a",
  currentPhase: {
    id: "normal",
    type: "normal",
    label: "Normal Play",
    sequence: 2,
    status: "active"
  },
  startedAt: "2026-06-17T11:35:00.000Z",
  version: 3,
  updatedAt
};

export const sampleMatchDetail: MatchDetail = {
  ...sampleMatchSummary,
  boxScore: {
    matchId: sampleMatchSummary.id,
    gameType: sampleMatchSummary.gameType,
    rows: [
      {
        subject: {
          type: "player",
          label: "Alex",
          playerId: "player-alex",
          teamId: "team-alpha"
        },
        stats: {
          makes: 2,
          misses: 1,
          shootingPercentage: 0.667,
          splashOuts: 0,
          dis: 1,
          tris: 0,
          guys: 0,
          voms: 0
        }
      },
      {
        subject: {
          type: "player",
          label: "Jordan",
          playerId: "player-jordan",
          teamId: "team-blue"
        },
        stats: {
          makes: 1,
          misses: 1,
          shootingPercentage: 0.5,
          splashOuts: 0,
          dis: 0,
          tris: 0,
          guys: 1,
          voms: 0
        }
      }
    ],
    totals: {
      makes: 5,
      misses: 4,
      shootingPercentage: 0.556,
      splashOuts: 0,
      dis: 1,
      tris: 0,
      guys: 1,
      voms: 0
    }
  },
  scorecard: {
    definition: ruskiScorecardDefinition,
    rows: [
      {
        id: "scorecard-row-1",
        matchId: sampleMatchSummary.id,
        sequence: 1,
        phaseId: "normal",
        teamId: "team-alpha",
        playerId: "player-alex",
        values: {
          shotNumber: 1,
          shooter: "Alex",
          miss: false,
          make: false,
          splashOut: false,
          guy: false,
          tri: false,
          di: true,
          vom: false
        },
        eventIds: ["event-2026-001"]
      },
      {
        id: "scorecard-row-2",
        matchId: sampleMatchSummary.id,
        sequence: 2,
        phaseId: "normal",
        teamId: "team-blue",
        playerId: "player-jordan",
        values: {
          shotNumber: 2,
          shooter: "Jordan",
          miss: false,
          make: false,
          splashOut: false,
          guy: true,
          tri: false,
          di: false,
          vom: false
        },
        eventIds: ["event-2026-002"]
      }
    ]
  },
  events: [
    {
      id: "event-2026-001",
      matchId: sampleMatchSummary.id,
      tournamentId: sampleMatchSummary.tournamentId,
      gameType: sampleMatchSummary.gameType,
      type: "di",
      sequence: 1,
      occurredAt: "2026-06-17T11:36:00.000Z",
      phaseId: "normal",
      teamId: "team-alpha",
      playerId: "player-alex",
      value: 2,
      metadata: {
        cupCount: 2
      }
    },
    {
      id: "event-2026-002",
      matchId: sampleMatchSummary.id,
      tournamentId: sampleMatchSummary.tournamentId,
      gameType: sampleMatchSummary.gameType,
      type: "guy",
      sequence: 2,
      occurredAt: "2026-06-17T11:41:00.000Z",
      phaseId: "normal",
      teamId: "team-blue",
      playerId: "player-jordan",
      value: 1,
      metadata: {
        cupCount: 1
      }
    }
  ],
  commentsSummary: {
    matchId: sampleMatchSummary.id,
    count: 0
  }
};

export const sampleTournament: Tournament = {
  id: "tournament-2026",
  year: 2026,
  name: "2026 Ruski Tournament",
  gameType: "ruski",
  status: "active",
  format: {
    type: "pod_and_bracket",
    podCount: 8,
    teamsPerPod: 4,
    bracketSize: 16,
    description: "Eight pods feed a sixteen-team championship bracket."
  },
  activeMatchIds: [sampleMatchSummary.id],
  featuredMatchIds: [sampleMatchSummary.id],
  pods: [
    {
      id: "pod-a",
      tournamentId: "tournament-2026",
      name: "Pod A",
      sequence: 1,
      teamIds: ["team-alpha", "team-blue"],
      matchIds: [sampleMatchSummary.id],
      standingIds: ["standing-team-alpha", "standing-team-blue"]
    }
  ],
  teams: [
    {
      id: "team-alpha",
      tournamentId: "tournament-2026",
      name: "Alpha Table",
      seed: {
        overall: 1,
        pod: 1
      },
      players: [
        {
          id: "player-alex",
          displayName: "Alex"
        },
        {
          id: "player-sam",
          displayName: "Sam"
        }
      ]
    },
    {
      id: "team-blue",
      tournamentId: "tournament-2026",
      name: "Blue Table",
      seed: {
        overall: 2,
        pod: 2
      },
      players: [
        {
          id: "player-jordan",
          displayName: "Jordan"
        },
        {
          id: "player-casey",
          displayName: "Casey"
        }
      ]
    }
  ],
  standings: [
    {
      id: "standing-team-alpha",
      tournamentId: "tournament-2026",
      scope: "pod",
      podId: "pod-a",
      teamId: "team-alpha",
      rank: 1,
      record: {
        wins: 1,
        losses: 0
      },
      gamesPlayed: 1,
      points: 2,
      metricValues: {
        cupDifferential: 1,
        shootingPercentage: 0.556
      }
    },
    {
      id: "standing-team-blue",
      tournamentId: "tournament-2026",
      scope: "pod",
      podId: "pod-a",
      teamId: "team-blue",
      rank: 2,
      record: {
        wins: 0,
        losses: 1
      },
      gamesPlayed: 1,
      points: 0,
      metricValues: {
        cupDifferential: -1,
        shootingPercentage: 0.5
      }
    }
  ],
  matchSummaries: [sampleMatchSummary],
  version: 3,
  updatedAt
};
