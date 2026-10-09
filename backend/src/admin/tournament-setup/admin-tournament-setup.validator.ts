import { HttpStatus, Injectable } from "@nestjs/common";

import { AppError, ErrorDetail } from "../../errors";
import {
  MAIN_TOURNAMENT_PRESET_ID,
  OFFICIAL_STANDINGS_RULES,
  TournamentFormatConfiguration,
  validateTournamentConfiguration
} from "../../tournament-engine/configuration";
import {
  isStableUuid,
  TournamentVisibility
} from "../../tournament-engine/domain";
import { AdminTournamentSetupRecord } from "../../tournament-engine/persistence";
import { CANONICAL_WORKBOOK_LIMITS } from "../../tournament-engine/workbook/schema";
import {
  AdminTournamentValidationIssue,
  CreateAdminTournamentRequest,
  PreviewAdminTournamentSetupRequest,
  PublishAdminTournamentSetupRequest,
  ReplaceAdminTournamentSetupRequest,
  ValidatedTournamentConfigurationSelection
} from "./admin-tournament-setup.contracts";

const MAXIMUM_NAME_LENGTH = 120;
const MAXIMUM_ADVANCED_TEAMS = 128;
const MAXIMUM_ADVANCED_PODS = 32;
const MAXIMUM_ADVANCED_PLAYERS_PER_TEAM = 8;
const MAXIMUM_ADVANCED_GAMES_PER_PAIR = 4;
const MAXIMUM_ADVANCED_BRACKET_SIZE = 256;
const MAXIMUM_CANONICAL_GAME_SHEETS =
  CANONICAL_WORKBOOK_LIMITS.maximumWorksheetCount - 3;

export interface ValidatedCreateTournamentRequest {
  name: string;
  year: number;
  configuration: ValidatedTournamentConfigurationSelection;
}

export interface ValidatedDraftPodRequest {
  id: string;
  name: string;
  normalizedName: string;
}

export interface ValidatedDraftPlayerRequest {
  id?: string;
  displayName: string;
  normalizedDisplayName: string;
  firstName?: string;
  lastName?: string;
  preferredName?: string;
}

export interface ValidatedDraftTeamRequest {
  id?: string;
  name: string;
  normalizedName: string;
  podId: string;
  initialSeed: number;
  players: ValidatedDraftPlayerRequest[];
}

export interface ValidatedReplaceDraftRequest {
  expectedRowVersion: number;
  pods: ValidatedDraftPodRequest[];
  teams: ValidatedDraftTeamRequest[];
}

@Injectable()
export class AdminTournamentSetupValidator {
  parseCreate(request: CreateAdminTournamentRequest | null | undefined):
  ValidatedCreateTournamentRequest {
    const details: ErrorDetail[] = [];
    const name = parseName(request?.name, "name", details);
    const year = parseYear(request?.year, details);
    const configuration = parseConfiguration(request?.configuration, details);
    throwIfInvalid(details, "Tournament draft is invalid.");
    return { name, year, configuration };
  }

  parseReplacement(
    request: ReplaceAdminTournamentSetupRequest | null | undefined,
    current: AdminTournamentSetupRecord
  ): ValidatedReplaceDraftRequest {
    const details: ErrorDetail[] = [];
    const expectedRowVersion = parseRowVersion(
      request?.expectedRowVersion,
      details
    );
    const pods = parsePods(request?.pods, current, details);
    const teams = parseTeams(request?.teams, current, details);

    rejectDuplicateNormalized(
      pods.map((pod) => pod.normalizedName),
      "pods",
      "DUPLICATE_POD_NAME",
      details
    );
    rejectDuplicateNormalized(
      teams.map((team) => team.normalizedName),
      "teams",
      "DUPLICATE_TEAM_NAME",
      details
    );
    rejectDuplicateIds(
      teams.flatMap((team) => team.id === undefined ? [] : [team.id]),
      "teams",
      details
    );
    rejectDuplicateIds(
      teams.flatMap((team) => team.players.flatMap((player) =>
        player.id === undefined ? [] : [player.id]
      )),
      "teams.players",
      details
    );
    rejectDuplicateSeeds(teams, details);
    throwIfInvalid(details, "Tournament setup is invalid.");

    return { expectedRowVersion, pods, teams };
  }

  parsePreview(
    request: PreviewAdminTournamentSetupRequest | null | undefined
  ): number {
    const details: ErrorDetail[] = [];
    const version = parseRowVersion(request?.expectedRowVersion, details);
    throwIfInvalid(details, "Schedule preview request is invalid.");
    return version;
  }

  parsePublish(
    request: PublishAdminTournamentSetupRequest | null | undefined
  ): {
    expectedRowVersion: number;
    previewDigest: string;
    visibility: TournamentVisibility;
  } {
    const details: ErrorDetail[] = [];
    if (request !== null && request !== undefined) {
      const unexpected = Object.keys(request).filter((key) =>
        !["expectedRowVersion", "previewDigest", "visibility"].includes(key)
      );
      if (unexpected.length > 0) {
        details.push({
          code: unexpected.includes("schedule")
            ? "CLIENT_SCHEDULE_NOT_ALLOWED"
            : "UNEXPECTED_PUBLICATION_FIELD",
          message: "Publication accepts only row version, preview digest, and visibility.",
          path: unexpected[0]
        });
      }
    }
    const expectedRowVersion = parseRowVersion(
      request?.expectedRowVersion,
      details
    );
    const previewDigest = typeof request?.previewDigest === "string"
      ? request.previewDigest.trim().toLowerCase()
      : "";
    if (!/^[a-f0-9]{64}$/.test(previewDigest)) {
      details.push({
        code: "INVALID_PREVIEW_DIGEST",
        message: "Preview digest must be a SHA-256 digest.",
        path: "previewDigest"
      });
    }
    const visibility = request?.visibility;
    if (visibility !== "private" && visibility !== "public") {
      details.push({
        code: "INVALID_TOURNAMENT_VISIBILITY",
        message: "Visibility must be private or public.",
        path: "visibility"
      });
    }
    throwIfInvalid(details, "Setup publication request is invalid.");
    return {
      expectedRowVersion,
      previewDigest,
      visibility: visibility as TournamentVisibility
    };
  }
}

function parseConfiguration(
  value: unknown,
  details: ErrorDetail[]
): ValidatedTournamentConfigurationSelection {
  if (!isObject(value)) {
    details.push({
      code: "TOURNAMENT_CONFIGURATION_REQUIRED",
      message: "Tournament configuration is required.",
      path: "configuration"
    });
    return { kind: "preset", presetId: MAIN_TOURNAMENT_PRESET_ID };
  }
  if (value.kind === "preset") {
    if (value.presetId !== MAIN_TOURNAMENT_PRESET_ID) {
      details.push({
        code: "UNKNOWN_TOURNAMENT_PRESET",
        message: "Tournament preset is not supported.",
        path: "configuration.presetId"
      });
    }
    return { kind: "preset", presetId: MAIN_TOURNAMENT_PRESET_ID };
  }
  if (value.kind === "advanced" && isObject(value.value)) {
    if (rejectOversizedAdvancedArrays(value.value, details)) {
      return { kind: "preset", presetId: MAIN_TOURNAMENT_PRESET_ID };
    }
    if (!isTournamentFormatConfiguration(value.value)) {
      details.push({
        code: "INVALID_ADVANCED_CONFIGURATION",
        message: "Advanced configuration fields have invalid types.",
        path: "configuration.value"
      });
      return {
        kind: "advanced",
        value: value.value as unknown as TournamentFormatConfiguration
      };
    }
    const configuration = value.value;
    const validation = validateTournamentConfiguration(configuration);
    details.push(...validation.errors.map((issue) => ({
      ...issue,
      path: `configuration.value.${issue.path}`
    })));
    validateAdvancedBounds(configuration, details);
    return { kind: "advanced", value: configuration };
  }
  details.push({
    code: "INVALID_TOURNAMENT_CONFIGURATION",
    message: "Configuration must select the main preset or advanced format.",
    path: "configuration"
  });
  return { kind: "preset", presetId: MAIN_TOURNAMENT_PRESET_ID };
}

function parsePods(
  value: unknown,
  current: AdminTournamentSetupRecord,
  details: ErrorDetail[]
): ValidatedDraftPodRequest[] {
  if (!Array.isArray(value)) {
    details.push({ code: "PODS_REQUIRED", message: "Pods must be an array.", path: "pods" });
    return [];
  }
  const currentPods = new Map<string, AdminTournamentSetupRecord["pods"][number]>(
    current.pods.map((pod) => [pod.id, pod])
  );
  if (value.length !== currentPods.size) {
    details.push({
      code: "POD_IDENTITIES_MUST_BE_PRESERVED",
      message: "Draft setup must include every configured pod exactly once.",
      path: "pods"
    });
  }
  if (value.length > currentPods.size) {
    return [];
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const object = isObject(entry) ? entry : {};
    const id = parseUuid(object.id, `pods.${index}.id`, details);
    if (seen.has(id)) {
      details.push({ code: "DUPLICATE_POD_ID", message: "Pod IDs must be unique.", path: `pods.${index}.id` });
    }
    seen.add(id);
    if (!currentPods.has(id)) {
      details.push({ code: "FOREIGN_POD_ID", message: "Pod ID does not belong to this draft.", path: `pods.${index}.id` });
    }
    const name = parseName(object.name, `pods.${index}.name`, details);
    return { id, name, normalizedName: normalizeName(name) };
  });
}

function parseTeams(
  value: unknown,
  current: AdminTournamentSetupRecord,
  details: ErrorDetail[]
): ValidatedDraftTeamRequest[] {
  if (!Array.isArray(value)) {
    details.push({ code: "TEAMS_REQUIRED", message: "Teams must be an array.", path: "teams" });
    return [];
  }
  if (value.length > current.configuration.teamCount) {
    details.push({
      code: "TOO_MANY_TEAMS",
      message: `Setup cannot contain more than ${current.configuration.teamCount} teams.`,
      path: "teams"
    });
    return [];
  }
  const pods = new Map<string, AdminTournamentSetupRecord["pods"][number]>(
    current.pods.map((pod) => [pod.id, pod])
  );
  const currentTeams = new Map<
    string,
    AdminTournamentSetupRecord["teams"][number]
  >(current.teams.map((team) => [team.id, team]));
  const currentPlayers = new Map<string, unknown>(
    current.teams.flatMap((team) =>
      team.players.map((player) => [player.id, player] as const)
    )
  );
  return value.map((entry, teamIndex) => {
    const object = isObject(entry) ? entry : {};
    const id = parseOptionalExistingUuid(
      object.id,
      `teams.${teamIndex}.id`,
      currentTeams,
      details,
      "team"
    );
    const name = parseName(object.name, `teams.${teamIndex}.name`, details);
    const podId = parseUuid(object.podId, `teams.${teamIndex}.podId`, details);
    if (!pods.has(podId)) {
      details.push({ code: "FOREIGN_POD_ID", message: "Pod ID does not belong to this draft.", path: `teams.${teamIndex}.podId` });
    }
    const initialSeed = parsePositiveInteger(
      object.initialSeed,
      `teams.${teamIndex}.initialSeed`,
      details
    );
    const pod = pods.get(podId);
    if (
      pod !== undefined &&
      initialSeed > current.configuration.podSizes[pod.sequence - 1]
    ) {
      details.push({
        code: "INITIAL_SEED_OUT_OF_RANGE",
        message: "Initial seed exceeds the configured pod size.",
        path: `teams.${teamIndex}.initialSeed`
      });
    }
    const playersValue = object.players;
    if (!Array.isArray(playersValue)) {
      details.push({ code: "PLAYERS_REQUIRED", message: "Players must be an array.", path: `teams.${teamIndex}.players` });
    }
    if (
      Array.isArray(playersValue) &&
      playersValue.length > current.configuration.playersPerTeam
    ) {
      details.push({
        code: "TOO_MANY_PLAYERS",
        message: `A team cannot contain more than ${current.configuration.playersPerTeam} players.`,
        path: `teams.${teamIndex}.players`
      });
    }
    const players = Array.isArray(playersValue) &&
      playersValue.length <= current.configuration.playersPerTeam
      ? playersValue.map((playerEntry, playerIndex) => parsePlayer(
        playerEntry,
        teamIndex,
        playerIndex,
        currentPlayers,
        details
      ))
      : [];
    return {
      ...(id === undefined ? {} : { id }),
      name,
      normalizedName: normalizeName(name),
      podId,
      initialSeed,
      players
    };
  });
}

function parsePlayer(
  value: unknown,
  teamIndex: number,
  playerIndex: number,
  existingPlayers: ReadonlyMap<string, unknown>,
  details: ErrorDetail[]
): ValidatedDraftPlayerRequest {
  const object = isObject(value) ? value : {};
  const path = `teams.${teamIndex}.players.${playerIndex}`;
  const id = parseOptionalExistingUuid(
    object.id,
    `${path}.id`,
    existingPlayers,
    details,
    "player"
  );
  const displayName = parseName(object.displayName, `${path}.displayName`, details);
  return {
    ...(id === undefined ? {} : { id }),
    displayName,
    normalizedDisplayName: normalizeName(displayName),
    ...optionalName(object.firstName, `${path}.firstName`, details, "firstName"),
    ...optionalName(object.lastName, `${path}.lastName`, details, "lastName"),
    ...optionalName(object.preferredName, `${path}.preferredName`, details, "preferredName")
  };
}

function optionalName(
  value: unknown,
  path: string,
  details: ErrorDetail[],
  key: "firstName" | "lastName" | "preferredName"
): Partial<Record<typeof key, string>> {
  if (value === undefined || value === null || value === "") {
    return {};
  }
  const name = parseName(value, path, details);
  return { [key]: name };
}

function parseName(value: unknown, path: string, details: ErrorDetail[]): string {
  if (typeof value !== "string") {
    details.push({ code: "NAME_REQUIRED", message: "Name is required.", path });
    return "";
  }
  if (value.length > MAXIMUM_NAME_LENGTH) {
    details.push({ code: "NAME_TOO_LONG", message: `Name must be ${MAXIMUM_NAME_LENGTH} characters or fewer.`, path });
    return "";
  }
  const name = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (name.length === 0) {
    details.push({ code: "NAME_REQUIRED", message: "Name is required.", path });
  } else if (name.length > MAXIMUM_NAME_LENGTH) {
    details.push({ code: "NAME_TOO_LONG", message: `Name must be ${MAXIMUM_NAME_LENGTH} characters or fewer.`, path });
  }
  return name;
}

function normalizeName(value: string): string {
  return value.toLocaleLowerCase("en-US");
}

function parseYear(value: unknown, details: ErrorDetail[]): number {
  if (!Number.isInteger(value) || Number(value) < 2000 || Number(value) > 2100) {
    details.push({ code: "INVALID_TOURNAMENT_YEAR", message: "Year must be an integer from 2000 through 2100.", path: "year" });
    return 2000;
  }
  return Number(value);
}

function parseRowVersion(value: unknown, details: ErrorDetail[]): number {
  return parsePositiveInteger(value, "expectedRowVersion", details);
}

function parsePositiveInteger(
  value: unknown,
  path: string,
  details: ErrorDetail[]
): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    details.push({ code: "INVALID_POSITIVE_INTEGER", message: "Value must be a positive integer.", path });
    return 1;
  }
  return Number(value);
}

function parseUuid(value: unknown, path: string, details: ErrorDetail[]): string {
  if (typeof value !== "string" || !isStableUuid(value)) {
    details.push({ code: "INVALID_STABLE_ID", message: "Value must be a non-nil UUID.", path });
    return "00000000-0000-4000-8000-000000000001";
  }
  return value.toLowerCase();
}

function parseOptionalExistingUuid(
  value: unknown,
  path: string,
  existing: ReadonlyMap<string, unknown>,
  details: ErrorDetail[],
  entity: string
): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const id = parseUuid(value, path, details);
  if (!existing.has(id)) {
    details.push({ code: "FOREIGN_STABLE_ID", message: `${entity} ID does not belong to this draft.`, path });
  }
  return id;
}

function rejectDuplicateNormalized(
  values: readonly string[],
  path: string,
  code: string,
  details: ErrorDetail[]
): void {
  if (new Set(values).size !== values.length) {
    details.push({ code, message: "Normalized names must be unique.", path });
  }
}

function rejectDuplicateIds(
  values: readonly string[],
  path: string,
  details: ErrorDetail[]
): void {
  if (new Set(values).size !== values.length) {
    details.push({ code: "DUPLICATE_STABLE_ID", message: "Stable IDs must be unique.", path });
  }
}

function rejectDuplicateSeeds(
  teams: readonly ValidatedDraftTeamRequest[],
  details: ErrorDetail[]
): void {
  const seeds = new Set<string>();
  for (const team of teams) {
    const key = `${team.podId}:${team.initialSeed}`;
    if (seeds.has(key)) {
      details.push({ code: "DUPLICATE_INITIAL_SEED", message: "Initial seeds must be unique within each pod.", path: "teams.initialSeed" });
      return;
    }
    seeds.add(key);
  }
}

function throwIfInvalid(details: ErrorDetail[], message: string): void {
  if (details.length > 0) {
    throw new AppError({ code: "BAD_REQUEST", message, statusCode: HttpStatus.BAD_REQUEST, details });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTournamentFormatConfiguration(
  value: Record<string, unknown>
): value is Record<string, unknown> & TournamentFormatConfiguration {
  return typeof value.formatVersion === "number" &&
    typeof value.formatType === "string" &&
    typeof value.teamCount === "number" &&
    typeof value.podCount === "number" &&
    Array.isArray(value.podSizes) &&
    value.podSizes.every((item) => typeof item === "number") &&
    typeof value.playersPerTeam === "number" &&
    typeof value.gamesPerPair === "number" &&
    typeof value.qualifiersPerPod === "number" &&
    typeof value.bracketSize === "number" &&
    typeof value.allowByes === "boolean" &&
    Array.isArray(value.standingsRules) &&
    value.standingsRules.every((item) => typeof item === "string");
}

function rejectOversizedAdvancedArrays(
  value: Record<string, unknown>,
  details: ErrorDetail[]
): boolean {
  let rejected = false;
  if (
    Array.isArray(value.podSizes) &&
    value.podSizes.length > MAXIMUM_ADVANCED_PODS
  ) {
    details.push({
      code: "ADVANCED_CONFIGURATION_LIMIT_EXCEEDED",
      message: `podSizes cannot contain more than ${MAXIMUM_ADVANCED_PODS} items.`,
      path: "configuration.value.podSizes"
    });
    rejected = true;
  }
  if (
    Array.isArray(value.standingsRules) &&
    value.standingsRules.length > OFFICIAL_STANDINGS_RULES.length
  ) {
    details.push({
      code: "ADVANCED_CONFIGURATION_LIMIT_EXCEEDED",
      message: `standingsRules cannot contain more than ${OFFICIAL_STANDINGS_RULES.length} items.`,
      path: "configuration.value.standingsRules"
    });
    rejected = true;
  }
  return rejected;
}

function validateAdvancedBounds(
  configuration: TournamentFormatConfiguration,
  details: ErrorDetail[]
): void {
  const bounds: Array<{
    value: number;
    maximum: number;
    path: string;
  }> = [
    {
      value: configuration.teamCount,
      maximum: MAXIMUM_ADVANCED_TEAMS,
      path: "teamCount"
    },
    {
      value: configuration.podCount,
      maximum: MAXIMUM_ADVANCED_PODS,
      path: "podCount"
    },
    {
      value: configuration.playersPerTeam,
      maximum: MAXIMUM_ADVANCED_PLAYERS_PER_TEAM,
      path: "playersPerTeam"
    },
    {
      value: configuration.gamesPerPair,
      maximum: MAXIMUM_ADVANCED_GAMES_PER_PAIR,
      path: "gamesPerPair"
    },
    {
      value: configuration.bracketSize,
      maximum: MAXIMUM_ADVANCED_BRACKET_SIZE,
      path: "bracketSize"
    }
  ];
  bounds.forEach((bound) => {
    if (!Number.isSafeInteger(bound.value) || bound.value > bound.maximum) {
      details.push({
        code: "ADVANCED_CONFIGURATION_LIMIT_EXCEEDED",
        message: `${bound.path} cannot exceed ${bound.maximum}.`,
        path: `configuration.value.${bound.path}`
      });
    }
  });
  details.push(...canonicalWorkbookCapacityIssues(configuration));
}

export function canonicalWorkbookCapacityIssues(
  configuration: TournamentFormatConfiguration
): AdminTournamentValidationIssue[] {
  const gameSheetCount = configuration.podSizes.reduce(
    (total, podSize) => total +
      podSize * (podSize - 1) / 2 * configuration.gamesPerPair,
    0
  );
  if (!Number.isSafeInteger(gameSheetCount) ||
      gameSheetCount > MAXIMUM_CANONICAL_GAME_SHEETS) {
    return [{
      code: "ADVANCED_CONFIGURATION_LIMIT_EXCEEDED",
      message: `Pod play cannot require more than ${MAXIMUM_CANONICAL_GAME_SHEETS} canonical game sheets.`,
      path: "configuration.value.podSizes"
    }];
  }
  return [];
}
