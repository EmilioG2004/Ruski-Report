import {
  parseStableUuid,
  TournamentPodSetup,
  TournamentSetup,
  TournamentSetupTeam
} from "../domain";
import {
  copyTournamentConfiguration,
  createMainTournamentConfiguration,
  MAIN_TOURNAMENT_PRESET,
  MAIN_TOURNAMENT_PRESET_ID,
  OFFICIAL_STANDINGS_RULES,
  POD_AND_SINGLE_ELIMINATION_FORMAT,
  TOURNAMENT_FORMAT_VERSION,
  TournamentFormatConfiguration,
  validateTournamentConfiguration,
  validateTournamentSetup
} from ".";

describe("tournament configuration", () => {
  it("provides an immutable valid copy of the built-in main preset", () => {
    const configuration = createMainTournamentConfiguration();

    expect(validateTournamentConfiguration(configuration)).toEqual({
      valid: true,
      errors: []
    });
    expect(configuration).toMatchObject({
      copiedFromPresetId: MAIN_TOURNAMENT_PRESET_ID,
      teamCount: 32,
      podCount: 8,
      podSizes: [4, 4, 4, 4, 4, 4, 4, 4],
      playersPerTeam: 2,
      qualifiersPerPod: 2,
      bracketSize: 16,
      allowByes: false
    });
    expect(configuration).not.toBe(MAIN_TOURNAMENT_PRESET.configuration);
    expect(configuration.podSizes).not.toBe(
      MAIN_TOURNAMENT_PRESET.configuration.podSizes
    );
    expect(Object.isFrozen(configuration)).toBe(true);
    expect(Object.isFrozen(configuration.podSizes)).toBe(true);
  });

  it("copies arrays independently from a custom source configuration", () => {
    const podSizes = [4, 4];
    const standingsRules = [...OFFICIAL_STANDINGS_RULES];
    const source: TournamentFormatConfiguration = {
      ...baseConfiguration(),
      teamCount: 8,
      podCount: 2,
      podSizes,
      standingsRules
    };
    const copied = copyTournamentConfiguration(source);

    podSizes[0] = 3;
    standingsRules.reverse();

    expect(copied.podSizes).toEqual([4, 4]);
    expect(copied.standingsRules).toEqual(OFFICIAL_STANDINGS_RULES);
  });

  it("accepts generalized v1 configurations with equal pod sizes and byes", () => {
    const configuration: TournamentFormatConfiguration = {
      ...baseConfiguration(),
      teamCount: 12,
      podCount: 3,
      podSizes: [4, 4, 4],
      qualifiersPerPod: 1,
      bracketSize: 4,
      allowByes: true
    };

    expect(validateTournamentConfiguration(configuration)).toEqual({
      valid: true,
      errors: []
    });
  });

  it.each([
    {
      name: "unequal or incorrect pod sizes",
      change: { podSizes: [3, 5] },
      codes: ["UNEQUAL_POD_SIZES"]
    },
    {
      name: "too many qualifiers",
      change: { qualifiersPerPod: 5 },
      codes: ["INVALID_QUALIFIERS_PER_POD"]
    },
    {
      name: "a non-power-of-two bracket",
      change: { bracketSize: 6 },
      codes: ["INVALID_BRACKET_SIZE"]
    },
    {
      name: "a bracket smaller than its qualifiers",
      change: { bracketSize: 2 },
      codes: ["BRACKET_TOO_SMALL"]
    },
    {
      name: "disabled required byes",
      change: {
        qualifiersPerPod: 1,
        bracketSize: 16,
        allowByes: false
      },
      codes: ["BYES_NOT_ALLOWED"]
    }
  ])("rejects $name", ({ change, codes }) => {
    const configuration: TournamentFormatConfiguration = {
      ...baseConfiguration(),
      ...change
    };
    const result = validateTournamentConfiguration(configuration);

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code))
      .toEqual(expect.arrayContaining(codes));
  });

  it("rejects a copied main preset that deviates from its fixed contract", () => {
    const configuration = copyTournamentConfiguration({
      ...MAIN_TOURNAMENT_PRESET.configuration,
      playersPerTeam: 3
    }, MAIN_TOURNAMENT_PRESET_ID);
    const result = validateTournamentConfiguration(configuration);

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "MAIN_PRESET_DEVIATION",
      path: "copiedFromPresetId"
    }));
  });

  it("validates complete team, roster, pod, assignment, and seed setup", () => {
    const configuration = createMainTournamentConfiguration();
    const setup = createMainSetup();

    expect(validateTournamentSetup(configuration, setup)).toEqual({
      valid: true,
      errors: []
    });
  });

  it("rejects duplicate pod seeds and team assignments", () => {
    const configuration = createMainTournamentConfiguration();
    const setup = createMainSetup();
    const firstPod = setup.pods[0];
    const secondPod = setup.pods[1];
    const invalid: TournamentSetup = {
      ...setup,
      pods: [
        {
          ...firstPod,
          teamAssignments: firstPod.teamAssignments.map(
            (assignment, index) => ({
              ...assignment,
              initialSeed: index < 2 ? 1 : assignment.initialSeed
            })
          )
        },
        {
          ...secondPod,
          teamAssignments: [
            {
              ...secondPod.teamAssignments[0],
              teamId: firstPod.teamAssignments[0].teamId
            },
            ...secondPod.teamAssignments.slice(1)
          ]
        },
        ...setup.pods.slice(2)
      ]
    };
    const codes = validateTournamentSetup(configuration, invalid)
      .errors.map((error) => error.code);

    expect(codes).toEqual(expect.arrayContaining([
      "INVALID_INITIAL_POD_SEEDS",
      "DUPLICATE_TEAM_ASSIGNMENT",
      "MISSING_TEAM_ASSIGNMENT"
    ]));
  });
});

function baseConfiguration(): TournamentFormatConfiguration {
  return {
    formatVersion: TOURNAMENT_FORMAT_VERSION,
    formatType: POD_AND_SINGLE_ELIMINATION_FORMAT,
    teamCount: 8,
    podCount: 2,
    podSizes: [4, 4],
    playersPerTeam: 2,
    gamesPerPair: 1,
    qualifiersPerPod: 2,
    bracketSize: 4,
    allowByes: false,
    standingsRules: OFFICIAL_STANDINGS_RULES
  };
}

function createMainSetup(): TournamentSetup {
  const tournamentId = parseStableUuid(uuid(1), "tournament");
  const teams: TournamentSetupTeam[] = Array.from(
    { length: 32 },
    (_, teamIndex) => ({
      id: parseStableUuid(uuid(100 + teamIndex), "tournament_team"),
      name: `Team ${teamIndex + 1}`,
      playerIds: [0, 1].map((playerIndex) => parseStableUuid(
        uuid(1_000 + teamIndex * 2 + playerIndex),
        "tournament_player"
      ))
    })
  );
  const pods: TournamentPodSetup[] = Array.from(
    { length: 8 },
    (_, podIndex) => ({
      id: parseStableUuid(uuid(500 + podIndex), "pod"),
      name: `Pod ${podIndex + 1}`,
      sequence: podIndex + 1,
      teamAssignments: teams
        .slice(podIndex * 4, podIndex * 4 + 4)
        .map((team, teamIndex) => ({
          teamId: team.id,
          initialSeed: teamIndex + 1
        }))
    })
  );

  return { tournamentId, teams, pods };
}

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}
