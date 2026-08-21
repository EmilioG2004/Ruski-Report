export const TOURNAMENT_FORMAT_VERSION = 1 as const;
export const POD_AND_SINGLE_ELIMINATION_FORMAT =
  "pod_and_single_elimination" as const;

export type TournamentFormatType =
  typeof POD_AND_SINGLE_ELIMINATION_FORMAT;

export type StandingsRule =
  | "record"
  | "cupDifferential"
  | "teamShootingPercentage"
  | "administratorResolution";

export const OFFICIAL_STANDINGS_RULES: readonly StandingsRule[] = Object.freeze([
  "record",
  "cupDifferential",
  "teamShootingPercentage",
  "administratorResolution"
]);

export interface TournamentFormatConfiguration {
  readonly formatVersion: number;
  readonly formatType: TournamentFormatType;
  readonly teamCount: number;
  readonly podCount: number;
  readonly podSizes: readonly number[];
  readonly playersPerTeam: number;
  readonly gamesPerPair: number;
  readonly qualifiersPerPod: number;
  readonly bracketSize: number;
  readonly allowByes: boolean;
  readonly standingsRules: readonly StandingsRule[];
}

export interface CopiedTournamentConfiguration
  extends TournamentFormatConfiguration {
  readonly copiedFromPresetId?: string;
}

export interface TournamentConfigurationPreset {
  readonly id: string;
  readonly name: string;
  readonly configuration: TournamentFormatConfiguration;
}

export function copyTournamentConfiguration(
  configuration: TournamentFormatConfiguration,
  copiedFromPresetId?: string
): CopiedTournamentConfiguration {
  return Object.freeze({
    ...configuration,
    podSizes: Object.freeze([...configuration.podSizes]),
    standingsRules: Object.freeze([...configuration.standingsRules]),
    ...(copiedFromPresetId === undefined ? {} : { copiedFromPresetId })
  });
}
