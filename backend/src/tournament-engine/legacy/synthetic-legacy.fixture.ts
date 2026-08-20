import { LegacyTournamentSource } from "./legacy-backfill.types";

const fixture: LegacyTournamentSource = {
  legacyTournamentId: "legacy-tournament-2026-synthetic",
  snapshotVersion: 7,
  snapshotPublishedAt: "2026-06-22T02:00:00.000Z",
  year: 2026,
  name: "Synthetic 2026 Legacy Tournament",
  gameType: "ruski",
  status: "completed",
  format: {
    type: "pod_and_bracket",
    podCount: 2,
    teamsPerPod: 2,
    bracketSize: 4
  },
  metadata: {
    fixture: "sanitized",
    locationName: "Synthetic Club"
  },
  teams: [
    team("legacy-team-alpha", "Synthetic Alpha", 1, 1, 1),
    team("legacy-team-bravo", "Synthetic Bravo", 2, 2, 4),
    team("legacy-team-charlie", "Synthetic Charlie", 3, 1, 2),
    team("legacy-team-delta", "Synthetic Delta", 4, 2, 3)
  ],
  players: [
    player("legacy-player-a1", "Alpha One"),
    player("legacy-player-a2", "Alpha Two"),
    player("legacy-player-a-former", "Alpha Former"),
    player("legacy-player-b1", "Bravo One"),
    player("legacy-player-b2", "Bravo Two"),
    player("legacy-player-c1", "Charlie One"),
    player("legacy-player-c2", "Charlie Two"),
    player("legacy-player-d1", "Delta One"),
    player("legacy-player-d2", "Delta Two")
  ],
  rosterMemberships: [
    membership("legacy-team-alpha", "legacy-player-a1", 1),
    membership("legacy-team-alpha", "legacy-player-a2", 2),
    membership("legacy-team-bravo", "legacy-player-b1", 1),
    membership("legacy-team-bravo", "legacy-player-b2", 2),
    membership("legacy-team-charlie", "legacy-player-c1", 1),
    membership("legacy-team-charlie", "legacy-player-c2", 2),
    membership("legacy-team-delta", "legacy-player-d1", 1),
    membership("legacy-team-delta", "legacy-player-d2", 2)
  ],
  pods: [
    {
      legacyPodId: "legacy-pod-a",
      name: "Synthetic Pod A",
      sequence: 1,
      legacyTeamIds: ["legacy-team-alpha", "legacy-team-bravo"],
      legacyMatchIds: ["legacy-match-pod-a"]
    },
    {
      legacyPodId: "legacy-pod-b",
      name: "Synthetic Pod B",
      sequence: 2,
      legacyTeamIds: ["legacy-team-charlie", "legacy-team-delta"],
      legacyMatchIds: []
    }
  ],
  matches: [
    {
      legacyMatchId: "legacy-match-pod-a",
      sequence: 1,
      status: "final",
      legacyPodId: "legacy-pod-a",
      participants: [
        participant(
          "legacy-team-alpha",
          ["legacy-player-a1", "legacy-player-a2"],
          10,
          "win",
          1
        ),
        participant(
          "legacy-team-bravo",
          ["legacy-player-b1", "legacy-player-b2"],
          7,
          "loss",
          2
        )
      ],
      score: finalScore(
        "legacy-team-alpha",
        10,
        "legacy-team-bravo",
        7,
        "legacy-team-alpha"
      ),
      updatedAt: "2026-06-20T16:00:00.000Z"
    },
    {
      legacyMatchId: "legacy-match-playoff-scored",
      sequence: 2,
      status: "final",
      legacyBracketMatchId: "legacy-bracket-semi-1",
      participants: [
        participant(
          "legacy-team-alpha",
          ["legacy-player-a-former", "legacy-player-a2"],
          10,
          "win",
          1
        ),
        participant(
          "legacy-team-charlie",
          ["legacy-player-c1", "legacy-player-c2"],
          8,
          "loss",
          2
        )
      ],
      score: finalScore(
        "legacy-team-alpha",
        10,
        "legacy-team-charlie",
        8,
        "legacy-team-alpha"
      ),
      updatedAt: "2026-06-21T19:00:00.000Z"
    },
    {
      legacyMatchId: "legacy-match-bracket-only-final",
      sequence: 3,
      status: "final",
      legacyBracketMatchId: "legacy-bracket-final",
      participants: [
        participant("legacy-team-alpha", [], undefined, "win", 1),
        participant("legacy-team-delta", [], undefined, "loss", 3)
      ],
      score: {
        participants: [],
        legacyWinnerTeamId: "legacy-team-alpha",
        isFinal: true,
        availability: "unrecorded"
      },
      detailAvailability: "unrecorded",
      updatedAt: "2026-06-21T22:00:00.000Z"
    }
  ],
  standings: [
    standing("legacy-standing-alpha", "legacy-team-alpha", "legacy-pod-a", 1, 1, 0, 3),
    standing("legacy-standing-bravo", "legacy-team-bravo", "legacy-pod-a", 2, 0, 1, -3),
    standing("legacy-standing-charlie", "legacy-team-charlie", "legacy-pod-b", 1, 1, 0, 2),
    standing("legacy-standing-delta", "legacy-team-delta", "legacy-pod-b", 2, 0, 1, -2)
  ],
  bracket: {
    legacyBracketId: "legacy-bracket-2026",
    name: "Synthetic Legacy Bracket",
    rounds: [
      {
        legacyRoundId: "legacy-round-semis",
        name: "Semifinals",
        sequence: 1,
        matches: [
          {
            legacyBracketMatchId: "legacy-bracket-semi-1",
            legacyMatchId: "legacy-match-playoff-scored",
            sequence: 1,
            status: "completed",
            legacyWinnerTeamId: "legacy-team-alpha",
            slots: [
              bracketTeamSlot(1, "legacy-team-alpha", 1),
              bracketTeamSlot(2, "legacy-team-charlie", 2)
            ]
          },
          {
            legacyBracketMatchId: "legacy-bracket-semi-2",
            sequence: 2,
            status: "completed",
            legacyWinnerTeamId: "legacy-team-delta",
            slots: [
              bracketTeamSlot(1, "legacy-team-delta", 3),
              bracketTeamSlot(2, "legacy-team-bravo", 4)
            ]
          }
        ]
      },
      {
        legacyRoundId: "legacy-round-final",
        name: "Final",
        sequence: 2,
        matches: [
          {
            legacyBracketMatchId: "legacy-bracket-final",
            legacyMatchId: "legacy-match-bracket-only-final",
            sequence: 1,
            status: "completed",
            legacyWinnerTeamId: "legacy-team-alpha",
            slots: [
              {
                sequence: 1,
                seed: 1,
                legacyTeamId: "legacy-team-alpha",
                sourceType: "match-winner",
                legacySourceBracketMatchId: "legacy-bracket-semi-1"
              },
              {
                sequence: 2,
                seed: 3,
                legacyTeamId: "legacy-team-delta",
                sourceType: "match-winner",
                legacySourceBracketMatchId: "legacy-bracket-semi-2"
              }
            ]
          }
        ]
      }
    ]
  },
  matchIdentities: [
    {
      legacyMatchId: "legacy-match-pod-a",
      commentIds: ["synthetic-comment-active"],
      reportIds: []
    },
    {
      legacyMatchId: "legacy-match-playoff-scored",
      commentIds: [],
      reportIds: []
    },
    {
      legacyMatchId: "legacy-match-bracket-only-final",
      commentIds: ["synthetic-comment-bracket-only"],
      reportIds: ["synthetic-report-bracket-only"]
    },
    {
      legacyMatchId: "legacy-match-historical-identity",
      commentIds: ["synthetic-comment-historical"],
      reportIds: ["synthetic-report-historical"]
    }
  ]
};

export function syntheticPopulatedLegacySource(): LegacyTournamentSource {
  return structuredClone(fixture);
}

function team(
  legacyTeamId: string,
  name: string,
  sequence: number,
  podSeed: number,
  overallSeed: number
) {
  return { legacyTeamId, name, sequence, podSeed, overallSeed };
}

function player(legacyPlayerId: string, displayName: string) {
  return { legacyPlayerId, displayName };
}

function membership(
  legacyTeamId: string,
  legacyPlayerId: string,
  sequence: number
) {
  return { legacyTeamId, legacyPlayerId, sequence };
}

function participant(
  legacyTeamId: string,
  legacyPlayerIds: string[],
  score: number | undefined,
  result: "win" | "loss",
  seed: number
) {
  return { legacyTeamId, legacyPlayerIds, score, result, seed };
}

function finalScore(
  firstTeamId: string,
  firstScore: number,
  secondTeamId: string,
  secondScore: number,
  winnerTeamId: string
) {
  return {
    participants: [
      { legacyTeamId: firstTeamId, score: firstScore },
      { legacyTeamId: secondTeamId, score: secondScore }
    ],
    legacyWinnerTeamId: winnerTeamId,
    isFinal: true
  };
}

function standing(
  legacyStandingId: string,
  legacyTeamId: string,
  legacyPodId: string,
  rank: number,
  wins: number,
  losses: number,
  cupDifferential: number
) {
  return {
    legacyStandingId,
    legacyTeamId,
    legacyPodId,
    scope: "pod" as const,
    rank,
    wins,
    losses,
    gamesPlayed: 1,
    points: wins * 2,
    metricValues: {
      cupDifferential,
      shootingPercentage: wins === 1 ? 0.55 : 0.45
    }
  };
}

function bracketTeamSlot(
  sequence: number,
  legacyTeamId: string,
  seed: number
) {
  return {
    sequence,
    seed,
    legacyTeamId,
    sourceType: "team" as const
  };
}
