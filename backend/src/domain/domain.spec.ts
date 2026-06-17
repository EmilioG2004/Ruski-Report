import {
  BoxScore,
  GameDefinition,
  MatchDetail,
  MatchSummary,
  Pod,
  ScorecardDefinition,
  Standing,
  Team,
  Tournament
} from ".";

const updatedAt = "2026-06-17T12:00:00.000Z";

function createTeams(count: number): Team[] {
  return Array.from({ length: count }, (_, index): Team => {
    const teamNumber = index + 1;

    return {
      id: `team-${teamNumber}`,
      tournamentId: "tournament-2026",
      name: `Team ${teamNumber}`,
      seed: {
        overall: teamNumber,
        pod: (index % 4) + 1
      },
      players: [
        {
          id: `player-${teamNumber}-1`,
          displayName: `Player ${teamNumber}A`
        },
        {
          id: `player-${teamNumber}-2`,
          displayName: `Player ${teamNumber}B`
        }
      ]
    };
  });
}

function createPods(teams: Team[]): Pod[] {
  return Array.from({ length: 8 }, (_, index): Pod => {
    const podNumber = index + 1;
    const podTeams = teams.slice(index * 4, index * 4 + 4);

    return {
      id: `pod-${podNumber}`,
      tournamentId: "tournament-2026",
      name: `Pod ${podNumber}`,
      sequence: podNumber,
      teamIds: podTeams.map((team) => team.id)
    };
  });
}

function createStandings(teams: Team[], pods: Pod[]): Standing[] {
  return teams.map((team, index): Standing => {
    const pod = pods[Math.floor(index / 4)];

    return {
      id: `standing-${team.id}`,
      tournamentId: "tournament-2026",
      scope: "pod",
      podId: pod.id,
      teamId: team.id,
      rank: (index % 4) + 1,
      record: {
        wins: 0,
        losses: 0
      },
      gamesPlayed: 0,
      metricValues: {
        cupDifferential: 0,
        shootingPercentage: null
      }
    };
  });
}

const ruskiScorecardDefinition: ScorecardDefinition = {
  id: "ruski-scorecard",
  gameType: "ruski",
  name: "Ruski Scorecard",
  rowLabel: "Shot",
  columns: [
    {
      key: "shotNumber",
      label: "Shot",
      dataType: "number",
      required: true
    },
    {
      key: "result",
      label: "Result",
      dataType: "event",
      eventTypeIds: ["make", "miss", "guy", "di", "tri", "vom"]
    }
  ]
};

const ruskiDefinition: GameDefinition = {
  gameType: "ruski",
  displayName: "Ruski",
  scorecardDefinitionId: ruskiScorecardDefinition.id,
  phases: [
    {
      id: "guy2guy",
      label: "Guy2Guy",
      sequence: 1
    },
    {
      id: "normal",
      label: "Normal Play",
      sequence: 2
    },
    {
      id: "redemption",
      label: "Redemption",
      sequence: 3
    },
    {
      id: "overtime",
      label: "Overtime",
      sequence: 4,
      isOvertime: true
    }
  ],
  eventTypes: [
    {
      id: "make",
      label: "Make",
      category: "score",
      affectsScore: true,
      countsAsAttempt: true,
      statKey: "makes"
    },
    {
      id: "miss",
      label: "Miss",
      category: "attempt",
      countsAsAttempt: true,
      statKey: "misses"
    },
    {
      id: "di",
      label: "Di",
      category: "attempt",
      countsAsAttempt: true,
      statKey: "dis",
      metadata: {
        countsAsMiss: true
      }
    },
    {
      id: "tri",
      label: "Tri",
      category: "attempt",
      countsAsAttempt: true,
      statKey: "tris",
      metadata: {
        countsAsMiss: true
      }
    },
    {
      id: "guy",
      label: "Guy",
      category: "attempt",
      countsAsAttempt: true,
      statKey: "guys"
    },
    {
      id: "vom",
      label: "Vom",
      category: "penalty",
      statKey: "voms"
    }
  ],
  stats: [
    {
      key: "makes",
      label: "Makes",
      scope: "player",
      valueType: "count"
    },
    {
      key: "misses",
      label: "Misses",
      scope: "player",
      valueType: "count"
    },
    {
      key: "dis",
      label: "Dis",
      scope: "player",
      valueType: "count"
    },
    {
      key: "tris",
      label: "Tris",
      scope: "player",
      valueType: "count"
    }
  ]
};

describe("domain model", () => {
  it("represents a 32-team pod-and-bracket tournament", () => {
    const teams = createTeams(32);
    const pods = createPods(teams);
    const standings = createStandings(teams, pods);

    const tournament: Tournament = {
      id: "tournament-2026",
      year: 2026,
      name: "2026 Ruski Tournament",
      gameType: "ruski",
      status: "active",
      format: {
        type: "pod_and_bracket",
        podCount: 8,
        teamsPerPod: 4,
        bracketSize: 16
      },
      activeMatchIds: [],
      featuredMatchIds: [],
      pods,
      teams,
      standings,
      matchSummaries: [],
      version: 1,
      updatedAt
    };

    expect(tournament.teams).toHaveLength(32);
    expect(tournament.pods).toHaveLength(8);
    expect(tournament.pods.every((pod) => pod.teamIds.length === 4)).toBe(true);
    expect(tournament.standings).toHaveLength(32);
    expect(tournament.format).toMatchObject({
      podCount: 8,
      teamsPerPod: 4,
      bracketSize: 16
    });
  });

  it("represents match detail with generic scorecard, events, and box score data", () => {
    const boxScore: BoxScore = {
      matchId: "match-1",
      gameType: "ruski",
      rows: [
        {
          subject: {
            type: "player",
            label: "Player 1A",
            playerId: "player-1-1",
            teamId: "team-1"
          },
          stats: {
            makes: 1,
            misses: 0,
            dis: 1,
            tris: 0
          }
        }
      ],
      totals: {
        makes: 1,
        misses: 0,
        dis: 1,
        tris: 0
      }
    };

    const match: MatchDetail = {
      id: "match-1",
      tournamentId: "tournament-2026",
      gameType: "ruski",
      status: "in_progress",
      participants: [
        {
          teamId: "team-1",
          role: "higher_seed",
          playerIds: ["player-1-1", "player-1-2"],
          score: 1,
          result: "pending"
        },
        {
          teamId: "team-2",
          role: "lower_seed",
          playerIds: ["player-2-1", "player-2-2"],
          score: 0,
          result: "pending"
        }
      ],
      score: {
        participants: [
          {
            teamId: "team-1",
            score: 1
          },
          {
            teamId: "team-2",
            score: 0
          }
        ],
        isFinal: false
      },
      currentPhase: {
        id: "normal",
        type: "normal",
        label: "Normal Play",
        sequence: 2,
        status: "active"
      },
      boxScore,
      scorecard: {
        definition: ruskiScorecardDefinition,
        rows: [
          {
            id: "row-1",
            matchId: "match-1",
            sequence: 1,
            phaseId: "normal",
            teamId: "team-1",
            playerId: "player-1-1",
            values: {
              shotNumber: 1,
              result: "di"
            },
            eventIds: ["event-1"]
          }
        ]
      },
      events: [
        {
          id: "event-1",
          matchId: "match-1",
          tournamentId: "tournament-2026",
          gameType: "ruski",
          type: "di",
          sequence: 1,
          phaseId: "normal",
          teamId: "team-1",
          playerId: "player-1-1",
          metadata: {
            cupCount: 2
          }
        }
      ],
      commentsSummary: {
        matchId: "match-1",
        count: 0
      },
      version: 3,
      updatedAt
    };

    expect(match.scorecard.definition.columns.map((column) => column.key)).toEqual([
      "shotNumber",
      "result"
    ]);
    expect(match.events.map((event) => event.type)).toEqual(["di"]);
    expect(match.boxScore.rows[0].stats.dis).toBe(1);
    expect(match).not.toHaveProperty("di");
    expect(match).not.toHaveProperty("tri");
    expect(match).not.toHaveProperty("guy");
  });

  it("keeps Ruski-specific scoring terms inside game definitions and events", () => {
    const ruskiEventIds = ruskiDefinition.eventTypes.map((eventType) => eventType.id);
    const diEvent = ruskiDefinition.eventTypes.find((eventType) => eventType.id === "di");
    const triEvent = ruskiDefinition.eventTypes.find((eventType) => eventType.id === "tri");

    expect(ruskiEventIds).toEqual(
      expect.arrayContaining(["make", "miss", "di", "tri", "guy", "vom"])
    );
    expect(diEvent).toMatchObject({
      category: "attempt",
      countsAsAttempt: true,
      statKey: "dis",
      metadata: {
        countsAsMiss: true
      }
    });
    expect(triEvent).toMatchObject({
      category: "attempt",
      countsAsAttempt: true,
      statKey: "tris",
      metadata: {
        countsAsMiss: true
      }
    });
  });

  it("supports lightweight match summaries separately from full match details", () => {
    const summary: MatchSummary = {
      id: "match-1",
      tournamentId: "tournament-2026",
      gameType: "ruski",
      status: "scheduled",
      participants: [
        {
          teamId: "team-1",
          score: 0
        },
        {
          teamId: "team-2",
          score: 0
        }
      ],
      score: {
        participants: [
          {
            teamId: "team-1",
            score: 0
          },
          {
            teamId: "team-2",
            score: 0
          }
        ],
        isFinal: false
      },
      version: 1,
      updatedAt
    };

    expect(summary).toMatchObject({
      id: "match-1",
      status: "scheduled"
    });
    expect(summary).not.toHaveProperty("scorecard");
    expect(summary).not.toHaveProperty("boxScore");
    expect(summary).not.toHaveProperty("events");
  });
});
