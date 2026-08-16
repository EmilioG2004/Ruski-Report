import {
  BoxScore,
  GameDefinition,
  GameEvent,
  MatchDetail,
  Tournament
} from "../domain";
import { UnsupportedGameTypeError } from "./errors";
import { GamePlugin } from "./game-plugin";
import { GamePluginRegistry } from "./game-plugin-registry";
import { ParsedScorebook } from "./parsed-scorebook";
import { ScorebookFile } from "./scorebook-file";
import { TournamentSnapshot } from "./tournament-snapshot";
import {
  validationFailed,
  validationPassed,
  ValidationResult
} from "./validation-result";

const updatedAt = "2026-06-17T12:00:00.000Z";

class FakeGamePlugin implements GamePlugin {
  readonly gameType = "fake";

  loadDefinition(): GameDefinition {
    return {
      gameType: this.gameType,
      displayName: "Fake Game",
      scorecardDefinitionId: "fake-scorecard",
      phases: [
        {
          id: "normal",
          label: "Normal Play",
          sequence: 1
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
        }
      ],
      stats: [
        {
          key: "makes",
          label: "Makes",
          scope: "player",
          valueType: "count"
        }
      ]
    };
  }

  async parseScorebook(file: ScorebookFile): Promise<ParsedScorebook> {
    return {
      gameType: this.gameType,
      source: {
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes
      },
      sheets: [
        {
          name: "Game 1",
          index: 0,
          role: "game",
          rows: []
        }
      ]
    };
  }

  validateScorebook(parsed: ParsedScorebook): ValidationResult {
    if (parsed.sheets.length === 0) {
      return validationFailed([
        {
          code: "NO_SHEETS",
          message: "Scorebook does not contain sheets.",
          severity: "error",
          path: "sheets"
        }
      ]);
    }

    return validationPassed();
  }

  async normalizeScorebook(parsed: ParsedScorebook): Promise<TournamentSnapshot> {
    const tournament: Tournament = {
      id: "fake-tournament",
      year: 2026,
      name: "Fake Tournament",
      gameType: this.gameType,
      status: "active",
      format: {
        type: "pod_and_bracket",
        podCount: 1,
        teamsPerPod: 2,
        bracketSize: 2
      },
      activeMatchIds: ["fake-match"],
      featuredMatchIds: ["fake-match"],
      pods: [
        {
          id: "fake-pod",
          tournamentId: "fake-tournament",
          name: "Fake Pod",
          sequence: 1,
          teamIds: ["team-1", "team-2"],
          matchIds: ["fake-match"]
        }
      ],
      teams: [],
      standings: [],
      matchSummaries: [],
      version: 1,
      updatedAt
    };

    const match: MatchDetail = {
      id: "fake-match",
      tournamentId: tournament.id,
      gameType: this.gameType,
      status: "final",
      participants: [
        {
          teamId: "team-1",
          score: 1,
          result: "win"
        },
        {
          teamId: "team-2",
          score: 0,
          result: "loss"
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
        winnerTeamId: "team-1",
        isFinal: true
      },
      boxScore: this.calculateStats([
        {
          id: "event-1",
          matchId: "fake-match",
          gameType: this.gameType,
          type: "make",
          sequence: 1,
          teamId: "team-1",
          playerId: "player-1"
        }
      ]),
      scorecard: {
        definition: {
          id: "fake-scorecard",
          gameType: this.gameType,
          name: "Fake Scorecard",
          columns: [
            {
              key: "result",
              label: "Result",
              dataType: "event",
              eventTypeIds: ["make"]
            }
          ]
        },
        rows: [
          {
            id: "row-1",
            matchId: "fake-match",
            sequence: 1,
            teamId: "team-1",
            playerId: "player-1",
            values: {
              result: "make"
            },
            eventIds: ["event-1"]
          }
        ]
      },
      events: [
        {
          id: "event-1",
          matchId: "fake-match",
          gameType: this.gameType,
          type: "make",
          sequence: 1,
          teamId: "team-1",
          playerId: "player-1"
        }
      ],
      version: 1,
      updatedAt
    };

    return {
      tournament: {
        ...tournament,
        matchSummaries: [match]
      },
      matches: [match],
      gameDefinition: this.loadDefinition(),
      source: parsed.source,
      validation: this.validateScorebook(parsed),
      generatedAt: updatedAt
    };
  }

  calculateStats(events: GameEvent[]): BoxScore {
    return {
      matchId: events[0]?.matchId ?? "unknown-match",
      gameType: this.gameType,
      rows: [
        {
          subject: {
            type: "player",
            label: "Player 1",
            playerId: "player-1",
            teamId: "team-1"
          },
          stats: {
            makes: events.filter((event) => event.type === "make").length
          }
        }
      ],
      totals: {
        makes: events.filter((event) => event.type === "make").length
      }
    };
  }
}

describe("GamePluginRegistry", () => {
  it("returns registered plugins by game type", async () => {
    const plugin = new FakeGamePlugin();
    const registry = new GamePluginRegistry([plugin]);

    const selectedPlugin = registry.get("fake");
    const parsed = await selectedPlugin.parseScorebook({
      buffer: Buffer.from("fake"),
      originalName: "fake.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 4
    });
    const snapshot = await selectedPlugin.normalizeScorebook(parsed);

    expect(registry.has("fake")).toBe(true);
    expect(registry.listSupportedGameTypes()).toEqual(["fake"]);
    expect(selectedPlugin.loadDefinition().gameType).toBe("fake");
    expect(parsed.sheets[0]).toMatchObject({
      name: "Game 1",
      role: "game"
    });
    expect(snapshot.tournament.gameType).toBe("fake");
    expect(snapshot.matches[0].boxScore.totals?.makes).toBe(1);
  });

  it("throws a typed error for unsupported game types", () => {
    const registry = new GamePluginRegistry([new FakeGamePlugin()]);

    expect(() => registry.get("ruski")).toThrow(UnsupportedGameTypeError);

    try {
      registry.get("ruski");
      fail("Expected unsupported game type error");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedGameTypeError);
      expect((error as UnsupportedGameTypeError).gameType).toBe("ruski");
      expect((error as UnsupportedGameTypeError).supportedGameTypes).toEqual([
        "fake"
      ]);
    }
  });

  it("represents validation failure without throwing", () => {
    const plugin = new FakeGamePlugin();
    const result = plugin.validateScorebook({
      gameType: "fake",
      source: {
        originalName: "empty.xlsx"
      },
      sheets: []
    });

    expect(result).toEqual({
      valid: false,
      errors: [
        {
          code: "NO_SHEETS",
          message: "Scorebook does not contain sheets.",
          severity: "error",
          path: "sheets"
        }
      ],
      warnings: []
    });
  });
});
