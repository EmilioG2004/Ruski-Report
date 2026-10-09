import { TournamentSetup } from "../domain/setup";
import { MAIN_TOURNAMENT_PRESET } from "./main-tournament-preset";
import {
  CopiedTournamentConfiguration,
  OFFICIAL_STANDINGS_RULES,
  POD_AND_SINGLE_ELIMINATION_FORMAT,
  TOURNAMENT_FORMAT_VERSION,
  TournamentFormatConfiguration
} from "./types";

export type TournamentConfigurationValidationCode =
  | "UNSUPPORTED_FORMAT_VERSION"
  | "UNSUPPORTED_FORMAT_TYPE"
  | "INVALID_TEAM_COUNT"
  | "INVALID_POD_COUNT"
  | "INVALID_POD_SIZES"
  | "UNEQUAL_POD_SIZES"
  | "INVALID_PLAYERS_PER_TEAM"
  | "INVALID_GAMES_PER_PAIR"
  | "INVALID_QUALIFIERS_PER_POD"
  | "INVALID_BRACKET_SIZE"
  | "BRACKET_TOO_SMALL"
  | "BYES_NOT_ALLOWED"
  | "UNSUPPORTED_STANDINGS_RULES"
  | "MAIN_PRESET_DEVIATION"
  | "INVALID_SETUP_TEAM_COUNT"
  | "DUPLICATE_TEAM_ID"
  | "INVALID_TEAM_ROSTER_SIZE"
  | "DUPLICATE_PLAYER_ID"
  | "INVALID_SETUP_POD_COUNT"
  | "DUPLICATE_POD_ID"
  | "INVALID_POD_SEQUENCE"
  | "INVALID_POD_TEAM_COUNT"
  | "UNKNOWN_TEAM_ASSIGNMENT"
  | "DUPLICATE_TEAM_ASSIGNMENT"
  | "MISSING_TEAM_ASSIGNMENT"
  | "INVALID_INITIAL_POD_SEEDS";

export interface TournamentConfigurationValidationIssue {
  readonly code: TournamentConfigurationValidationCode;
  readonly message: string;
  readonly path: string;
}

export interface TournamentConfigurationValidationResult {
  readonly valid: boolean;
  readonly errors: readonly TournamentConfigurationValidationIssue[];
}

export function validateTournamentConfiguration(
  configuration: TournamentFormatConfiguration | CopiedTournamentConfiguration
): TournamentConfigurationValidationResult {
  const errors: TournamentConfigurationValidationIssue[] = [];

  if (configuration.formatVersion !== TOURNAMENT_FORMAT_VERSION) {
    errors.push(issue(
      "UNSUPPORTED_FORMAT_VERSION",
      `Format version must be ${TOURNAMENT_FORMAT_VERSION}.`,
      "formatVersion"
    ));
  }

  if (configuration.formatType !== POD_AND_SINGLE_ELIMINATION_FORMAT) {
    errors.push(issue(
      "UNSUPPORTED_FORMAT_TYPE",
      `Format type must be '${POD_AND_SINGLE_ELIMINATION_FORMAT}'.`,
      "formatType"
    ));
  }

  if (!isPositiveInteger(configuration.teamCount)) {
    errors.push(issue(
      "INVALID_TEAM_COUNT",
      "Team count must be a positive integer.",
      "teamCount"
    ));
  }

  if (!isPositiveInteger(configuration.podCount)) {
    errors.push(issue(
      "INVALID_POD_COUNT",
      "Pod count must be a positive integer.",
      "podCount"
    ));
  }

  validatePodSizes(configuration, errors);

  if (!isPositiveInteger(configuration.playersPerTeam)) {
    errors.push(issue(
      "INVALID_PLAYERS_PER_TEAM",
      "Players per team must be a positive integer.",
      "playersPerTeam"
    ));
  }

  if (!isPositiveInteger(configuration.gamesPerPair)) {
    errors.push(issue(
      "INVALID_GAMES_PER_PAIR",
      "Games per pair must be a positive integer.",
      "gamesPerPair"
    ));
  }

  const smallestPod = Math.min(...configuration.podSizes);
  if (
    !isPositiveInteger(configuration.qualifiersPerPod) ||
    Number.isFinite(smallestPod) &&
      configuration.qualifiersPerPod > smallestPod
  ) {
    errors.push(issue(
      "INVALID_QUALIFIERS_PER_POD",
      "Qualifiers per pod must be positive and cannot exceed pod size.",
      "qualifiersPerPod"
    ));
  }

  if (
    !isPositiveInteger(configuration.bracketSize) ||
    configuration.bracketSize < 2 ||
    !isPowerOfTwo(configuration.bracketSize)
  ) {
    errors.push(issue(
      "INVALID_BRACKET_SIZE",
      "Bracket size must be a power of two greater than or equal to two.",
      "bracketSize"
    ));
  }

  const qualifierCount =
    configuration.podCount * configuration.qualifiersPerPod;
  if (
    isPositiveInteger(qualifierCount) &&
    configuration.bracketSize < qualifierCount
  ) {
    errors.push(issue(
      "BRACKET_TOO_SMALL",
      "Bracket size cannot be smaller than the qualifier count.",
      "bracketSize"
    ));
  }

  if (
    isPositiveInteger(qualifierCount) &&
    qualifierCount < configuration.bracketSize &&
    !configuration.allowByes
  ) {
    errors.push(issue(
      "BYES_NOT_ALLOWED",
      "A bracket larger than the qualifier count must allow byes.",
      "allowByes"
    ));
  }

  if (!arraysEqual(configuration.standingsRules, OFFICIAL_STANDINGS_RULES)) {
    errors.push(issue(
      "UNSUPPORTED_STANDINGS_RULES",
      "Generalized v1 uses the official ordered standings rules.",
      "standingsRules"
    ));
  }

  if (
    "copiedFromPresetId" in configuration &&
    configuration.copiedFromPresetId === MAIN_TOURNAMENT_PRESET.id &&
    !configurationMatches(
      configuration,
      MAIN_TOURNAMENT_PRESET.configuration
    )
  ) {
    errors.push(issue(
      "MAIN_PRESET_DEVIATION",
      "The built-in main preset cannot deviate from its 32/8/4/2/16 contract.",
      "copiedFromPresetId"
    ));
  }

  return result(errors);
}

export function validateTournamentSetup(
  configuration: TournamentFormatConfiguration,
  setup: TournamentSetup
): TournamentConfigurationValidationResult {
  const errors: TournamentConfigurationValidationIssue[] = [];
  const teamsById = new Map(setup.teams.map((team) => [team.id, team]));

  if (setup.teams.length !== configuration.teamCount) {
    errors.push(issue(
      "INVALID_SETUP_TEAM_COUNT",
      `Setup must contain exactly ${configuration.teamCount} teams.`,
      "teams"
    ));
  }

  if (teamsById.size !== setup.teams.length) {
    errors.push(issue(
      "DUPLICATE_TEAM_ID",
      "Every setup team must have a unique stable ID.",
      "teams"
    ));
  }

  const allPlayerIds = setup.teams.flatMap((team, teamIndex) => {
    if (team.playerIds.length !== configuration.playersPerTeam) {
      errors.push(issue(
        "INVALID_TEAM_ROSTER_SIZE",
        `Team '${team.id}' must have ${configuration.playersPerTeam} players.`,
        `teams.${teamIndex}.playerIds`
      ));
    }
    return team.playerIds;
  });

  if (new Set(allPlayerIds).size !== allPlayerIds.length) {
    errors.push(issue(
      "DUPLICATE_PLAYER_ID",
      "A tournament player can belong to only one initial roster.",
      "teams.playerIds"
    ));
  }

  if (setup.pods.length !== configuration.podCount) {
    errors.push(issue(
      "INVALID_SETUP_POD_COUNT",
      `Setup must contain exactly ${configuration.podCount} pods.`,
      "pods"
    ));
  }

  if (new Set(setup.pods.map((pod) => pod.id)).size !== setup.pods.length) {
    errors.push(issue(
      "DUPLICATE_POD_ID",
      "Every setup pod must have a unique stable ID.",
      "pods"
    ));
  }

  const expectedPodSequences = Array.from(
    { length: configuration.podCount },
    (_, index) => index + 1
  );
  const actualPodSequences = setup.pods
    .map((pod) => pod.sequence)
    .sort((first, second) => first - second);
  if (!arraysEqual(actualPodSequences, expectedPodSequences)) {
    errors.push(issue(
      "INVALID_POD_SEQUENCE",
      "Pod sequences must be unique and contiguous starting at one.",
      "pods.sequence"
    ));
  }

  const assignmentCounts = new Map<string, number>();
  setup.pods.forEach((pod, podIndex) => {
    const expectedSize = configuration.podSizes[pod.sequence - 1];
    if (
      expectedSize !== undefined &&
      pod.teamAssignments.length !== expectedSize
    ) {
      errors.push(issue(
        "INVALID_POD_TEAM_COUNT",
        `Pod ${pod.sequence} must contain exactly ${expectedSize} teams.`,
        `pods.${podIndex}.teamAssignments`
      ));
    }

    const seeds = pod.teamAssignments
      .map((assignment) => assignment.initialSeed)
      .sort((first, second) => first - second);
    const expectedSeeds = Array.from(
      { length: pod.teamAssignments.length },
      (_, index) => index + 1
    );
    if (!arraysEqual(seeds, expectedSeeds)) {
      errors.push(issue(
        "INVALID_INITIAL_POD_SEEDS",
        "Initial pod seeds must be unique and contiguous starting at one.",
        `pods.${podIndex}.teamAssignments.initialSeed`
      ));
    }

    pod.teamAssignments.forEach((assignment, assignmentIndex) => {
      if (!teamsById.has(assignment.teamId)) {
        errors.push(issue(
          "UNKNOWN_TEAM_ASSIGNMENT",
          `Pod assignment references unknown team '${assignment.teamId}'.`,
          `pods.${podIndex}.teamAssignments.${assignmentIndex}.teamId`
        ));
      }
      assignmentCounts.set(
        assignment.teamId,
        (assignmentCounts.get(assignment.teamId) ?? 0) + 1
      );
    });
  });

  assignmentCounts.forEach((count, teamId) => {
    if (count > 1) {
      errors.push(issue(
        "DUPLICATE_TEAM_ASSIGNMENT",
        `Team '${teamId}' is assigned to more than one pod.`,
        "pods.teamAssignments"
      ));
    }
  });

  setup.teams.forEach((team) => {
    if ((assignmentCounts.get(team.id) ?? 0) === 0) {
      errors.push(issue(
        "MISSING_TEAM_ASSIGNMENT",
        `Team '${team.id}' is not assigned to a pod.`,
        "pods.teamAssignments"
      ));
    }
  });

  return result(errors);
}

function validatePodSizes(
  configuration: TournamentFormatConfiguration,
  errors: TournamentConfigurationValidationIssue[]
): void {
  const validShape =
    configuration.podSizes.length === configuration.podCount &&
    configuration.podSizes.every(isPositiveInteger) &&
    configuration.podSizes.reduce((total, size) => total + size, 0) ===
      configuration.teamCount;

  if (!validShape) {
    errors.push(issue(
      "INVALID_POD_SIZES",
      "Pod sizes must be positive, match pod count, and sum to team count.",
      "podSizes"
    ));
  }

  if (
    configuration.podSizes.length > 0 &&
    new Set(configuration.podSizes).size !== 1
  ) {
    errors.push(issue(
      "UNEQUAL_POD_SIZES",
      "Generalized v1 requires equal pod sizes.",
      "podSizes"
    ));
  }
}

function configurationMatches(
  first: TournamentFormatConfiguration,
  second: TournamentFormatConfiguration
): boolean {
  return first.formatVersion === second.formatVersion &&
    first.formatType === second.formatType &&
    first.teamCount === second.teamCount &&
    first.podCount === second.podCount &&
    arraysEqual(first.podSizes, second.podSizes) &&
    first.playersPerTeam === second.playersPerTeam &&
    first.gamesPerPair === second.gamesPerPair &&
    first.qualifiersPerPod === second.qualifiersPerPod &&
    first.bracketSize === second.bracketSize &&
    first.allowByes === second.allowByes &&
    arraysEqual(first.standingsRules, second.standingsRules);
}

function arraysEqual<T>(first: readonly T[], second: readonly T[]): boolean {
  return first.length === second.length &&
    first.every((value, index) => value === second[index]);
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function issue(
  code: TournamentConfigurationValidationCode,
  message: string,
  path: string
): TournamentConfigurationValidationIssue {
  return { code, message, path };
}

function result(
  errors: readonly TournamentConfigurationValidationIssue[]
): TournamentConfigurationValidationResult {
  return {
    valid: errors.length === 0,
    errors
  };
}
