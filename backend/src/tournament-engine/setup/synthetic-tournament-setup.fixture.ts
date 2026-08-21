import {
  copyTournamentConfiguration,
  createMainTournamentConfiguration,
  OFFICIAL_STANDINGS_RULES,
  POD_AND_SINGLE_ELIMINATION_FORMAT,
  TOURNAMENT_FORMAT_VERSION
} from "../configuration";
import {
  parseStableUuid,
  TournamentSetup
} from "../domain";

export function createCompleteMainTournamentSetup(): TournamentSetup {
  return createSetup(32, 8, 4, 2);
}

export function createCompleteSmallTournamentSetup(): TournamentSetup {
  return createSetup(4, 2, 2, 2);
}

export function createSmallTournamentConfiguration() {
  return copyTournamentConfiguration({
    formatVersion: TOURNAMENT_FORMAT_VERSION,
    formatType: POD_AND_SINGLE_ELIMINATION_FORMAT,
    teamCount: 4,
    podCount: 2,
    podSizes: [2, 2],
    playersPerTeam: 2,
    gamesPerPair: 1,
    qualifiersPerPod: 1,
    bracketSize: 2,
    allowByes: false,
    standingsRules: OFFICIAL_STANDINGS_RULES
  });
}

export const completeMainTournamentFixture = Object.freeze({
  configuration: createMainTournamentConfiguration(),
  setup: createCompleteMainTournamentSetup()
});

export const completeSmallTournamentFixture = Object.freeze({
  configuration: createSmallTournamentConfiguration(),
  setup: createCompleteSmallTournamentSetup()
});

function createSetup(
  teamCount: number,
  podCount: number,
  podSize: number,
  playersPerTeam: number
): TournamentSetup {
  const tournamentId = parseStableUuid(uuid(1), "tournament");
  const teams = Array.from({ length: teamCount }, (_, teamIndex) => ({
    id: parseStableUuid(uuid(100 + teamIndex), "tournament_team"),
    name: `Sanitized Team ${teamIndex + 1}`,
    playerIds: Array.from({ length: playersPerTeam }, (_, playerIndex) =>
      parseStableUuid(
        uuid(1_000 + teamIndex * playersPerTeam + playerIndex),
        "tournament_player"
      )
    )
  }));
  const pods = Array.from({ length: podCount }, (_, podIndex) => ({
    id: parseStableUuid(uuid(500 + podIndex), "pod"),
    name: `Pod ${podIndex + 1}`,
    sequence: podIndex + 1,
    teamAssignments: teams
      .slice(podIndex * podSize, (podIndex + 1) * podSize)
      .map((team, teamIndex) => ({
        teamId: team.id,
        initialSeed: teamIndex + 1
      }))
  }));
  return { tournamentId, teams, pods };
}

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}
