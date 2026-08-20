import { AppError } from "../../errors";
import { parseStableUuid } from "../../tournament-engine/domain";
import { AdminTournamentSetupRecord } from "../../tournament-engine/persistence";
import { completeSmallTournamentFixture } from "../../tournament-engine/setup";
import { AdminTournamentSetupValidator } from "./admin-tournament-setup.validator";

describe("AdminTournamentSetupValidator", () => {
  const validator = new AdminTournamentSetupValidator();
  const current = setupRecord();

  it("accepts a structurally safe incomplete draft", () => {
    const firstTeam = current.teams[0];
    const result = validator.parseReplacement({
      expectedRowVersion: 1,
      pods: current.pods.map((pod) => ({ id: pod.id, name: pod.name })),
      teams: [{
        name: "New Team",
        podId: firstTeam.podId,
        initialSeed: 1,
        players: []
      }]
    }, current);

    expect(result.teams).toHaveLength(1);
    expect(result.teams[0].id).toBeUndefined();
    expect(result.teams[0].players).toEqual([]);
  });

  it("rejects foreign stable IDs and duplicate normalized names", () => {
    const firstTeam = current.teams[0];
    expect(() => validator.parseReplacement({
      expectedRowVersion: 1,
      pods: current.pods.map((pod) => ({ id: pod.id, name: pod.name })),
      teams: [1, 2].map(() => ({
        id: "00000000-0000-4000-8000-000000009999",
        name: " Same   Team ",
        podId: firstTeam.podId,
        initialSeed: 1,
        players: []
      }))
    }, current)).toThrow(AppError);

    try {
      validator.parseReplacement({
        expectedRowVersion: 1,
        pods: current.pods.map((pod) => ({ id: pod.id, name: pod.name })),
        teams: [1, 2].map((seed) => ({
          name: " Same   Team ",
          podId: firstTeam.podId,
          initialSeed: seed,
          players: []
        }))
      }, current);
      fail("Expected duplicate normalized names to fail");
    } catch (error) {
      expect((error as AppError).details.map((detail) => detail.code))
        .toContain("DUPLICATE_TEAM_NAME");
    }
  });

  it("rejects malformed advanced configuration without throwing a type error", () => {
    expect(() => validator.parseCreate({
      name: "Advanced Tournament",
      year: 2027,
      configuration: {
        kind: "advanced",
        value: { teamCount: 8 }
      }
    })).toThrow(AppError);
  });

  it("bounds raw names before whitespace normalization", () => {
    expect(() => validator.parseCreate({
      name: `Tournament${" ".repeat(120)}Name`,
      year: 2027,
      configuration: { kind: "preset", presetId: "ruski-main-32-team" }
    })).toThrow(AppError);
  });

  it("rejects a body-sized podSizes array before general validation", () => {
    let caught: unknown;
    try {
      validator.parseCreate({
        name: "Bounded Advanced Tournament",
        year: 2027,
        configuration: {
          kind: "advanced",
          value: {
            formatVersion: 1,
            formatType: "pod_and_single_elimination",
            teamCount: 1,
            podCount: 1,
            podSizes: Array.from({ length: 126_000 }, () => 1),
            playersPerTeam: 1,
            gamesPerPair: 1,
            qualifiersPerPod: 1,
            bracketSize: 2,
            allowByes: true,
            standingsRules: [
              "record",
              "cupDifferential",
              "teamShootingPercentage",
              "administratorResolution"
            ]
          }
        }
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect(caught).toMatchObject({
      code: "BAD_REQUEST",
      statusCode: 400,
      details: [expect.objectContaining({
        code: "ADVANCED_CONFIGURATION_LIMIT_EXCEEDED",
        path: "configuration.value.podSizes"
      })]
    });
  });

  it("allows distinct players to share a display name", () => {
    const pod = current.pods[0];
    const result = validator.parseReplacement({
      expectedRowVersion: 1,
      pods: current.pods.map((item) => ({ id: item.id, name: item.name })),
      teams: [{
        name: "Team Alpha",
        podId: pod.id,
        initialSeed: 1,
        players: [{ displayName: "Shared Player Name" }]
      }, {
        name: "Team Beta",
        podId: pod.id,
        initialSeed: 2,
        players: [{ displayName: "Shared Player Name" }]
      }]
    }, current);

    expect(result.teams.flatMap((team) => team.players)
      .map((player) => player.displayName)).toEqual([
      "Shared Player Name",
      "Shared Player Name"
    ]);
  });

  it("rejects malformed publication state", () => {
    expect(() => validator.parsePublish({
      expectedRowVersion: 0,
      previewDigest: "not-a-digest",
      visibility: "featured"
    })).toThrow(AppError);
  });

  it("rejects client-supplied publication schedules", () => {
    expect(() => validator.parsePublish({
      expectedRowVersion: 1,
      previewDigest: "a".repeat(64),
      visibility: "public",
      schedule: [{ id: "client-match" }]
    } as never)).toThrow(AppError);
  });
});

function setupRecord(): AdminTournamentSetupRecord {
  const fixture = completeSmallTournamentFixture;
  return {
    tournament: {
      tournamentId: fixture.setup.tournamentId,
      publicKey: fixture.setup.tournamentId,
      gameType: "ruski",
      year: 2027,
      name: "Tournament",
      lifecycle: "draft_setup",
      visibility: "private",
      rowVersion: 1,
      setupPublishedAt: null,
      createdAt: "2027-01-01T00:00:00.000Z",
      updatedAt: "2027-01-01T00:00:00.000Z"
    },
    configuration: fixture.configuration,
    pods: fixture.setup.pods.map((pod) => ({
      id: pod.id,
      publicKey: pod.id,
      name: pod.name,
      normalizedName: pod.name.toLowerCase(),
      sequence: pod.sequence
    })),
    teams: fixture.setup.teams.map((team, teamIndex) => {
      const pod = fixture.setup.pods[Math.floor(teamIndex / 2)];
      return {
        id: team.id,
        publicKey: team.id,
        name: team.name,
        normalizedName: team.name.toLowerCase(),
        sequence: teamIndex + 1,
        podId: pod.id,
        initialSeed: teamIndex % 2 + 1,
        players: team.playerIds.map((playerId, playerIndex) => ({
          id: playerId,
          publicKey: playerId,
          displayName: `Player ${teamIndex + 1}-${playerIndex + 1}`,
          membershipId: parseStableUuid(playerId, "roster_membership"),
          membershipPublicKey: playerId,
          rosterSlot: playerIndex + 1
        }))
      };
    })
  };
}
