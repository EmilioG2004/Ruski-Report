import {
  createMainTournamentConfiguration,
  OFFICIAL_STANDINGS_RULES,
  POD_AND_SINGLE_ELIMINATION_FORMAT,
  TOURNAMENT_FORMAT_VERSION,
  TournamentFormatConfiguration
} from "../configuration";
import {
  parseStableUuid,
  TournamentId,
  TournamentPodSetup,
  TournamentSetup,
  TournamentSetupTeam,
  TournamentTeamId
} from "../domain";
import {
  createStablePlayoffMatchId,
  generatePodRoundRobinSchedule
} from ".";

describe("pod round-robin scheduling", () => {
  it("generates 48 scheduled matches for the main preset", () => {
    const configuration = createMainTournamentConfiguration();
    const setup = createSetup(
      parseStableUuid(uuid(1), "tournament"),
      8,
      4,
      2
    );
    const schedule = generatePodRoundRobinSchedule(configuration, setup);

    expect(schedule).toHaveLength(48);
    setup.pods.forEach((pod) => {
      expect(schedule.filter((match) => match.podId === pod.id)).toHaveLength(6);
    });
    expect(schedule.every((match) =>
      match.status === "scheduled" &&
      match.scoreAvailability === "not_started" &&
      match.scheduledAt === null
    )).toBe(true);
  });

  it("uses deterministic round and pairing order", () => {
    const configuration = configurationFor(4, 1, 4);
    const setup = createSetup(
      parseStableUuid(uuid(1), "tournament"),
      1,
      4,
      2
    );
    const seedByTeam = new Map(
      setup.pods[0].teamAssignments.map((assignment) => [
        assignment.teamId,
        assignment.initialSeed
      ])
    );
    const schedule = generatePodRoundRobinSchedule(configuration, setup);

    expect(schedule.map((match) => ({
      round: match.roundNumber,
      seeds: match.participantTeamIds.map((teamId) => seedByTeam.get(teamId))
    }))).toEqual([
      { round: 1, seeds: [1, 4] },
      { round: 1, seeds: [2, 3] },
      { round: 2, seeds: [1, 3] },
      { round: 2, seeds: [2, 4] },
      { round: 3, seeds: [1, 2] },
      { round: 3, seeds: [3, 4] }
    ]);
  });

  it("keeps schedule order and UUID match identities stable across regeneration", () => {
    const tournamentId = parseStableUuid(uuid(1), "tournament");
    const configuration = createMainTournamentConfiguration();
    const setup = createSetup(tournamentId, 8, 4, 2);
    const reordered: TournamentSetup = {
      ...setup,
      teams: [...setup.teams].reverse(),
      pods: [...setup.pods].reverse().map((pod) => ({
        ...pod,
        teamAssignments: [...pod.teamAssignments].reverse()
      }))
    };

    const first = generatePodRoundRobinSchedule(configuration, setup);
    const second = generatePodRoundRobinSchedule(configuration, reordered);

    expect(second).toEqual(first);
    expect(new Set(first.map((match) => match.id)).size).toBe(first.length);
    expect(first.every((match) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        match.id
      )
    )).toBe(true);
  });

  it("scopes otherwise identical schedules to stable tournament identity", () => {
    const configuration = configurationFor(4, 1, 4);
    const firstSetup = createSetup(
      parseStableUuid(uuid(1), "tournament"),
      1,
      4,
      2
    );
    const secondSetup: TournamentSetup = {
      ...firstSetup,
      tournamentId: parseStableUuid(uuid(2), "tournament")
    };
    const firstIds = new Set(
      generatePodRoundRobinSchedule(configuration, firstSetup)
        .map((match) => match.id)
    );
    const secondIds = generatePodRoundRobinSchedule(configuration, secondSetup)
      .map((match) => match.id);

    expect(secondIds.every((id) => !firstIds.has(id))).toBe(true);
  });

  it("gives pod and playoff stages distinct match identities", () => {
    const configuration = configurationFor(4, 1, 4);
    const setup = createSetup(
      parseStableUuid(uuid(1), "tournament"),
      1,
      4,
      2
    );
    const podMatchId = generatePodRoundRobinSchedule(configuration, setup)[0].id;
    const playoffMatchId = createStablePlayoffMatchId({
      tournamentId: setup.tournamentId,
      bracketMatchId: parseStableUuid(uuid(900), "bracket_match")
    });

    expect(playoffMatchId).not.toBe(podMatchId);
  });

  it("supports repeated games per pair without identity collisions", () => {
    const configuration: TournamentFormatConfiguration = {
      ...configurationFor(4, 1, 4),
      gamesPerPair: 2
    };
    const setup = createSetup(
      parseStableUuid(uuid(1), "tournament"),
      1,
      4,
      2
    );
    const schedule = generatePodRoundRobinSchedule(configuration, setup);

    expect(schedule).toHaveLength(12);
    expect(schedule.map((match) => match.roundNumber)).toEqual([
      1, 1, 2, 2, 3, 3,
      4, 4, 5, 5, 6, 6
    ]);
    expect(new Set(schedule.map((match) => match.id)).size).toBe(12);
  });

  it("schedules odd-sized equal pods without creating bye matches", () => {
    const configuration: TournamentFormatConfiguration = {
      ...configurationFor(3, 1, 3),
      qualifiersPerPod: 2,
      bracketSize: 2,
      allowByes: false
    };
    const setup = createSetup(
      parseStableUuid(uuid(1), "tournament"),
      1,
      3,
      2
    );
    const schedule = generatePodRoundRobinSchedule(configuration, setup);

    expect(schedule).toHaveLength(3);
    expect(schedule.map((match) => match.roundNumber)).toEqual([1, 2, 3]);
    expect(schedule.every((match) => match.participantTeamIds.length === 2))
      .toBe(true);
  });
});

function configurationFor(
  teamCount: number,
  podCount: number,
  podSize: number
): TournamentFormatConfiguration {
  return {
    formatVersion: TOURNAMENT_FORMAT_VERSION,
    formatType: POD_AND_SINGLE_ELIMINATION_FORMAT,
    teamCount,
    podCount,
    podSizes: Array.from({ length: podCount }, () => podSize),
    playersPerTeam: 2,
    gamesPerPair: 1,
    qualifiersPerPod: 2,
    bracketSize: 2 ** Math.ceil(Math.log2(podCount * 2)),
    allowByes: podCount * 2 < 2 ** Math.ceil(Math.log2(podCount * 2)),
    standingsRules: OFFICIAL_STANDINGS_RULES
  };
}

function createSetup(
  tournamentId: TournamentId,
  podCount: number,
  teamsPerPod: number,
  playersPerTeam: number
): TournamentSetup {
  const teamCount = podCount * teamsPerPod;
  const teams: TournamentSetupTeam[] = Array.from(
    { length: teamCount },
    (_, teamIndex) => ({
      id: parseStableUuid(uuid(100 + teamIndex), "tournament_team"),
      name: `Team ${teamIndex + 1}`,
      playerIds: Array.from({ length: playersPerTeam }, (_, playerIndex) =>
        parseStableUuid(
          uuid(1_000 + teamIndex * playersPerTeam + playerIndex),
          "tournament_player"
        )
      )
    })
  );
  const pods: TournamentPodSetup[] = Array.from(
    { length: podCount },
    (_, podIndex) => ({
      id: parseStableUuid(uuid(500 + podIndex), "pod"),
      name: `Pod ${podIndex + 1}`,
      sequence: podIndex + 1,
      teamAssignments: teams
        .slice(podIndex * teamsPerPod, (podIndex + 1) * teamsPerPod)
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
