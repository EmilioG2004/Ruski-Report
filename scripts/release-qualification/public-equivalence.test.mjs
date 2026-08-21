import assert from "node:assert/strict";
import test from "node:test";

import { comparePublicContracts } from "./public-equivalence.mjs";

test("accepts material v1 and v2 public equivalence", () => {
  assert.deepEqual(comparePublicContracts(fixture()), {
    equivalent: true,
    mismatches: []
  });
});

test("reports safe rule codes for divergent public data", () => {
  const input = fixture();
  input.canonicalMatches[0].participants[0].score = 5;
  input.canonicalTournament.rosters[0].players[0].displayName = "Changed";
  const result = comparePublicContracts(input);

  assert.deepEqual(result.mismatches, [
    { code: "team_roster" },
    { code: "match_summary" }
  ]);
  assert.doesNotMatch(JSON.stringify(result), /Changed|Red One/u);
});

test("compares standings statistics events scorecards and box scores", () => {
  const input = fixture();
  input.canonicalTournament.pods[0].standings[0].wins = 2;
  input.canonicalTournament.statistics[0].values.makes = 8;
  input.canonicalMatchDetails[0].events[0].details.outcome = "missed";
  input.canonicalMatchDetails[0].scorecard.rows[0].playerId = "changed-player";
  input.canonicalMatchDetails[0].boxScore.rows[0].values.makes = 8;

  assert.deepEqual(comparePublicContracts(input).mismatches, [
    { code: "standings" },
    { code: "tournament_statistics" },
    { code: "match_details" }
  ]);
});

function fixture() {
  const legacyMatches = [{
    id: "match-1",
    status: "final",
    participants: [
      { teamId: "team-red", playerIds: ["red-1"] },
      { teamId: "team-blue", playerIds: ["blue-1"] }
    ],
    score: {
      participants: [
        { teamId: "team-red", score: 6 },
        { teamId: "team-blue", score: 4 }
      ],
      winnerTeamId: "team-red"
    }
  }];
  return {
    legacyTournament: {
      id: "tournament-1",
      gameType: "ruski",
      year: 2026,
      name: "Tournament",
      teams: [
        {
          id: "team-red",
          name: "Red",
          seed: { overall: 1 },
          players: [{ id: "red-1", displayName: "Red One" }]
        },
        {
          id: "team-blue",
          name: "Blue",
          seed: { overall: 2 },
          players: [{ id: "blue-1", displayName: "Blue One" }]
        }
      ],
      standings: [{
        teamId: "team-red",
        podId: "pod-a",
        rank: 1,
        record: { wins: 1, losses: 0 },
        metricValues: {
          cupDifferential: 2,
          makes: 7,
          attempts: 10,
          shootingPercentage: 0.7
        }
      }, {
        teamId: "team-blue",
        podId: "pod-a",
        rank: 2,
        record: { wins: 0, losses: 1 },
        metricValues: {
          cupDifferential: -2,
          makes: 5,
          attempts: 10,
          shootingPercentage: 0.5
        }
      }],
      statistics: [{
        scope: "season",
        rows: [{
          subject: { teamId: "team-red" },
          values: { makes: 7 }
        }]
      }],
      bracket: {
        rounds: [{ matches: [{
          id: "bracket-1",
          matchId: "match-1",
          winnerTeamId: "team-red",
          slots: [
            { teamId: "team-red", seed: 1, source: { type: "team" } },
            { teamId: "team-blue", seed: 2, source: { type: "team" } }
          ]
        }] }]
      }
    },
    legacyMatches,
    canonicalTournament: {
      id: "tournament-1",
      gameType: "ruski",
      year: 2026,
      name: "Tournament",
      rosters: [
        {
          id: "team-blue",
          name: "Blue",
          players: [{ id: "blue-1", displayName: "Blue One" }]
        },
        {
          id: "team-red",
          name: "Red",
          players: [{ id: "red-1", displayName: "Red One" }]
        }
      ],
      pods: [{
        id: "pod-a",
        standings: [{
          team: { id: "team-red" },
          rank: 1,
          wins: 1,
          losses: 0,
          cupDifferential: 2,
          makes: 7,
          attempts: 10,
          shootingPercentage: 0.7
        }, {
          team: { id: "team-blue" },
          rank: 2,
          wins: 0,
          losses: 1,
          cupDifferential: -2,
          makes: 5,
          attempts: 10,
          shootingPercentage: 0.5
        }]
      }],
      statistics: [{
        scope: "tournament",
        stage: "pod_play",
        subject: { id: "team-red" },
        values: { makes: 7 }
      }],
      seeds: [
        { team: { id: "team-red" }, effectiveSeed: 1 },
        { team: { id: "team-blue" }, effectiveSeed: 2 }
      ],
      bracket: {
        rounds: [{ matches: [{
          id: "bracket-1",
          matchId: "match-1",
          winner: { id: "team-red" },
          slots: [
            { source: "team", team: { id: "team-red" }, seed: 1 },
            { source: "team", team: { id: "team-blue" }, seed: 2 }
          ]
        }] }]
      }
    },
    canonicalMatches: [{
      id: "match-1",
      status: "final",
      scoreAvailability: "complete",
      participants: [
        { team: { id: "team-blue" }, players: [{ id: "blue-1" }], score: 4 },
        { team: { id: "team-red" }, players: [{ id: "red-1" }], score: 6 }
      ],
      winner: { id: "team-red" }
    }],
    legacyMatchDetails: [{
      id: "match-1",
      participants: [
        { teamId: "team-red", playerIds: ["red-1"] },
        { teamId: "team-blue", playerIds: ["blue-1"] }
      ],
      events: [{
        sequence: 1,
        type: "make",
        teamId: "team-red",
        playerId: "red-1"
      }],
      boxScore: {
        rows: [{
          subject: { teamId: "team-red" },
          stats: { makes: 7 }
        }]
      },
      scorecard: {
        rows: [{ sequence: 1, teamId: "team-red", playerId: "red-1" }]
      }
    }],
    canonicalMatchDetails: [{
      id: "match-1",
      participants: [
        { team: { id: "team-blue" }, players: [{ id: "blue-1" }] },
        { team: { id: "team-red" }, players: [{ id: "red-1" }] }
      ],
      events: [{
        sequence: 1,
        type: "shot_attempt",
        teamId: "team-red",
        playerId: "red-1",
        details: { outcome: "made" }
      }],
      boxScore: {
        rows: [{
          subject: { id: "team-red" },
          values: { makes: 7 }
        }]
      },
      scorecard: {
        rows: [{ sequence: 1, teamId: "team-red", playerId: "red-1" }]
      }
    }]
  };
}
