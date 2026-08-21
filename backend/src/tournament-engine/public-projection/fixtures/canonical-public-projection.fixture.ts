import {
  CanonicalPublicMatch,
  CanonicalPublicProjectionPayloadSet,
  CanonicalPublicTournament
} from "../contracts";

const tournamentId = "summer-classic-2027";
const teamA = { id: "team-alpha", name: "Alpha" } as const;
const teamB = { id: "team-beta", name: "Beta" } as const;
const currentA = [{ id: "player-new-a", displayName: "New A", rosterSlot: 1 }];
const currentB = [{ id: "player-b", displayName: "Player B", rosterSlot: 1 }];
const historicalA = [{
  id: "player-old-a",
  displayName: "Old A",
  rosterSlot: 1
}];

export const canonicalPublicProjectionFixture: CanonicalPublicProjectionPayloadSet = {
  tournament: {
    id: tournamentId,
    gameType: "ruski",
    year: 2027,
    name: "Summer Classic",
    lifecycle: "playoffs",
    format: {
      formatVersion: 1,
      formatType: "pod_and_single_elimination",
      teamCount: 2,
      podCount: 1,
      podSizes: [2],
      playersPerTeam: 1,
      gamesPerPair: 1,
      qualifiersPerPod: 2,
      bracketSize: 4,
      allowByes: true,
      standingsRules: [
        "record",
        "cupDifferential",
        "teamShootingPercentage",
        "administratorResolution"
      ]
    },
    rosters: [
      {
        ...teamA,
        podId: "pod-one",
        initialPodSeed: 1,
        players: currentA
      },
      {
        ...teamB,
        podId: "pod-one",
        initialPodSeed: 2,
        players: currentB
      }
    ],
    pods: [{
      id: "pod-one",
      name: "Pod One",
      sequence: 1,
      standingState: "unresolved_tie",
      finalizedAt: null,
      standings: [
        standing(teamA, 1, "tie-one", false),
        standing(teamB, 1, "tie-one", false)
      ]
    }],
    seeds: [
      { team: teamB, calculatedSeed: 2, effectiveSeed: 1, overridden: true },
      { team: teamA, calculatedSeed: 1, effectiveSeed: 2, overridden: true }
    ],
    statistics: [],
    matches: [],
    bracket: {
      id: "main-bracket",
      name: "Playoffs",
      size: 4,
      rounds: [{
        id: "semifinal",
        name: "Semifinal",
        sequence: 1,
        matches: [{
          id: "semifinal-one",
          round: 1,
          position: 1,
          status: "corrected",
          matchId: "playoff-rematch-two",
          replacedMatchId: "playoff-rematch-one",
          slots: [
            { source: "team", team: teamA, seed: 2 },
            { source: "team", team: teamB, seed: 1 }
          ],
          winner: null
        }, {
          id: "semifinal-two",
          round: 1,
          position: 2,
          status: "bye",
          matchId: null,
          replacedMatchId: null,
          slots: [
            { source: "team", team: teamB, seed: 1 },
            { source: "bye", team: null, seed: null }
          ],
          winner: teamB
        }]
      }, {
        id: "championship",
        name: "Championship",
        sequence: 2,
        matches: [{
          id: "championship-one",
          round: 2,
          position: 1,
          status: "pending",
          matchId: null,
          replacedMatchId: null,
          slots: [
            {
              source: "match_winner",
              sourceBracketMatchId: "semifinal-one",
              team: null,
              seed: null
            },
            { source: "tbd", team: null, seed: null }
          ],
          winner: null
        }]
      }]
    }
  },
  matches: [
    match("scheduled-match", "scheduled", "not_started", currentA, currentB),
    match("live-match", "in_progress", "partial", currentA, currentB, 3, 2),
    match("final-match", "final", "complete", historicalA, currentB, 5, 3),
    {
      ...match("forfeit-match", "forfeited", "not_applicable", currentA, currentB),
      participants: [{
        side: 1,
        role: "home",
        team: teamA,
        players: currentA,
        seed: null,
        score: null,
        result: "win"
      }, {
        side: 2,
        role: "away",
        team: teamB,
        players: currentB,
        seed: null,
        score: null,
        result: "forfeited"
      }],
      winner: teamA
    },
    match("unrecorded-match", "final", "unrecorded", historicalA, currentB),
    match("cancelled-match", "cancelled", "not_applicable", currentA, currentB),
    {
      ...match(
        "playoff-rematch-one",
        "final",
        "complete",
        historicalA,
        currentB,
        4,
        5,
        "playoffs"
      ),
      bracketMatchId: "semifinal-one",
      correction: {
        isCorrection: true,
        reason: "Winner corrected",
        previousRevision: 1,
        replacesMatchId: null,
        replacedByMatchId: "playoff-rematch-two"
      }
    },
    {
      ...match(
        "playoff-rematch-two",
        "scheduled",
        "not_started",
        currentA,
        currentB,
        null,
        null,
        "playoffs"
      ),
      bracketMatchId: "semifinal-one",
      instance: 2,
      correction: {
        isCorrection: true,
        reason: null,
        previousRevision: null,
        replacesMatchId: "playoff-rematch-one",
        replacedByMatchId: null
      }
    }
  ]
};

(canonicalPublicProjectionFixture.tournament as unknown as {
  matches: readonly CanonicalPublicMatch[];
}).matches = canonicalPublicProjectionFixture.matches;

function standing(
  team: typeof teamA | typeof teamB,
  rank: number,
  tieGroup: string,
  administratorResolved: boolean
) {
  return {
    team,
    rank,
    wins: 0,
    losses: 0,
    cupDifferential: 0,
    makes: 0,
    attempts: 0,
    shootingPercentage: null,
    tieGroup,
    administratorResolved
  };
}

function match(
  id: string,
  status: CanonicalPublicMatch["status"],
  scoreAvailability: CanonicalPublicMatch["scoreAvailability"],
  playersA: typeof currentA,
  playersB: typeof currentB,
  scoreA: number | null = null,
  scoreB: number | null = null,
  stage: CanonicalPublicMatch["stage"] = "pod_play"
): CanonicalPublicMatch {
  const hasScore = scoreAvailability === "complete" || scoreAvailability === "partial";
  return {
    id,
    sequence: 1,
    stage,
    podId: stage === "pod_play" ? "pod-one" : null,
    bracketMatchId: null,
    instance: 1,
    revision: status === "scheduled" ? null : 1,
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
      startedAt: status === "scheduled" ? null : "2027-08-01T12:00:00.000Z",
      endedAt: ["final", "forfeited", "cancelled"].includes(status)
        ? "2027-08-01T13:00:00.000Z"
        : null,
      updatedAt: "2027-08-01T13:00:00.000Z"
    },
    participants: [{
      side: 1,
      role: "home",
      team: teamA,
      players: playersA,
      seed: stage === "playoffs" ? 2 : null,
      score: hasScore ? scoreA : null,
      result: status === "final" && scoreA !== null && scoreB !== null
        ? scoreA > scoreB ? "win" : "loss"
        : null
    }, {
      side: 2,
      role: "away",
      team: teamB,
      players: playersB,
      seed: stage === "playoffs" ? 1 : null,
      score: hasScore ? scoreB : null,
      result: status === "final" && scoreA !== null && scoreB !== null
        ? scoreB > scoreA ? "win" : "loss"
        : null
    }],
    winner: status === "final" && scoreA !== null && scoreB !== null
      ? scoreA > scoreB ? teamA : teamB
      : null,
    events: [],
    statistics: [],
    boxScore: hasScore ? { columns: [], rows: [], totals: {} } : null,
    scorecard: hasScore ? { columns: [], rows: [] } : null
  };
}
