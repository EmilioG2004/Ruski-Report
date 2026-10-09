import {
  copyTournamentConfiguration,
  OFFICIAL_STANDINGS_RULES,
  POD_AND_SINGLE_ELIMINATION_FORMAT,
  TOURNAMENT_FORMAT_VERSION,
  TournamentConfigurationPreset
} from "./types";

export const MAIN_TOURNAMENT_PRESET_ID = "ruski-main-32-team";

const mainTournamentConfiguration = copyTournamentConfiguration({
  formatVersion: TOURNAMENT_FORMAT_VERSION,
  formatType: POD_AND_SINGLE_ELIMINATION_FORMAT,
  teamCount: 32,
  podCount: 8,
  podSizes: [4, 4, 4, 4, 4, 4, 4, 4],
  playersPerTeam: 2,
  gamesPerPair: 1,
  qualifiersPerPod: 2,
  bracketSize: 16,
  allowByes: false,
  standingsRules: OFFICIAL_STANDINGS_RULES
});

export const MAIN_TOURNAMENT_PRESET: TournamentConfigurationPreset =
  Object.freeze({
    id: MAIN_TOURNAMENT_PRESET_ID,
    name: "Main Ruski Tournament",
    configuration: mainTournamentConfiguration
  });

export function createMainTournamentConfiguration() {
  return copyTournamentConfiguration(
    MAIN_TOURNAMENT_PRESET.configuration,
    MAIN_TOURNAMENT_PRESET.id
  );
}
