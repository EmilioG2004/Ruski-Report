import { HttpStatus } from "@nestjs/common";

import { AppError } from "../../errors";
import {
  OFFICIAL_STANDINGS_RULES,
  POD_AND_SINGLE_ELIMINATION_FORMAT,
  TOURNAMENT_FORMAT_VERSION
} from "../../tournament-engine/configuration";
import {
  AdminTournamentDetailResponse,
  CreateAdminTournamentRequest,
  PublishAdminTournamentSetupRequest,
  ReplaceAdminTournamentSetupRequest
} from "../tournament-setup";

export type FlatForm = Readonly<Record<string, string>>;

const MAXIMUM_ADVANCED_TEAMS = 128;
const MAXIMUM_ADVANCED_PODS = 32;
const MAXIMUM_ADVANCED_PLAYERS_PER_TEAM = 8;

export const MAXIMUM_ADMIN_WEB_SETUP_FORM_FIELDS =
  calculateAdminSetupFormFieldCount(
    MAXIMUM_ADVANCED_TEAMS,
    MAXIMUM_ADVANCED_PODS,
    MAXIMUM_ADVANCED_PLAYERS_PER_TEAM
  );

export function calculateAdminSetupFormFieldCount(
  teamCount: number,
  podCount: number,
  playersPerTeam: number
): number {
  const commandFields = 2;
  const fieldsPerPod = 2;
  const fieldsPerTeam = 4;
  const fieldsPerPlayer = 5;
  return commandFields + podCount * fieldsPerPod +
    teamCount * (fieldsPerTeam + playersPerTeam * fieldsPerPlayer);
}

export function parseSignInForm(body: unknown): {
  csrf: string;
  loginName: string;
  password: string;
} {
  const form = parseFlatForm(body, new Set(["_csrf", "loginName", "password"]));
  return {
    csrf: required(form, "_csrf"),
    loginName: required(form, "loginName"),
    password: required(form, "password", false)
  };
}

export function parseInvitationForm(body: unknown): {
  csrf: string;
  token: string;
  password: string;
} {
  const form = parseFlatForm(body, new Set(["_csrf", "token", "password"]));
  return {
    csrf: required(form, "_csrf"),
    token: required(form, "token"),
    password: required(form, "password", false)
  };
}

export const parseRecoveryForm = parseInvitationForm;

export function parseCreateTournamentForm(body: unknown): {
  csrf: string;
  request: CreateAdminTournamentRequest;
  values: FlatForm;
} {
  const names = new Set([
    "_csrf",
    "name",
    "year",
    "configuration.kind",
    "configuration.value.teamCount",
    "configuration.value.podCount",
    "configuration.value.podSize",
    "configuration.value.playersPerTeam",
    "configuration.value.gamesPerPair",
    "configuration.value.qualifiersPerPod",
    "configuration.value.bracketSize",
    "configuration.value.allowByes"
  ]);
  const form = parseFlatForm(body, names);
  const kind = required(form, "configuration.kind");
  const configuration = kind === "preset"
    ? { kind: "preset", presetId: "ruski-main-32-team" }
    : advancedConfiguration(form, kind);
  return {
    csrf: required(form, "_csrf"),
    values: form,
    request: {
      name: required(form, "name"),
      year: integer(form, "year"),
      configuration
    }
  };
}

export function parseSetupForm(
  body: unknown,
  detail: AdminTournamentDetailResponse
): {
  csrf: string;
  request: ReplaceAdminTournamentSetupRequest;
  values: FlatForm;
} {
  const names = setupFieldNames(detail);
  const form = parseFlatForm(body, names);
  const pods = detail.pods.map((_pod, podIndex) => ({
    id: required(form, `pods.${podIndex}.id`),
    name: required(form, `pods.${podIndex}.name`)
  }));
  const teams = Array.from(
    { length: detail.configuration.teamCount },
    (_, teamIndex) => {
      const id = required(form, `teams.${teamIndex}.id`);
      const name = required(form, `teams.${teamIndex}.name`);
      const players = Array.from(
        { length: detail.configuration.playersPerTeam },
        (_, playerIndex) => {
          const prefix = `teams.${teamIndex}.players.${playerIndex}`;
          const playerId = required(form, `${prefix}.id`);
          const displayName = required(form, `${prefix}.displayName`);
          const firstName = required(form, `${prefix}.firstName`);
          const lastName = required(form, `${prefix}.lastName`);
          const preferredName = required(form, `${prefix}.preferredName`);
          const populated = [
            playerId,
            displayName,
            firstName,
            lastName,
            preferredName
          ].some((value) => value.length > 0);
          return populated ? [{
            ...(playerId.length === 0 ? {} : { id: playerId }),
            displayName,
            ...(firstName.length === 0 ? {} : { firstName }),
            ...(lastName.length === 0 ? {} : { lastName }),
            ...(preferredName.length === 0 ? {} : { preferredName })
          }] : [];
        }
      ).flat();
      const populated = id.length > 0 || name.length > 0 || players.length > 0;
      return populated ? [{
        ...(id.length === 0 ? {} : { id }),
        name,
        podId: required(form, `teams.${teamIndex}.podId`),
        initialSeed: integer(form, `teams.${teamIndex}.initialSeed`),
        players
      }] : [];
    }
  ).flat();
  return {
    csrf: required(form, "_csrf"),
    values: form,
    request: {
      expectedRowVersion: integer(form, "expectedRowVersion"),
      pods,
      teams
    }
  };
}

export function parsePublishForm(body: unknown): {
  csrf: string;
  request: PublishAdminTournamentSetupRequest;
} {
  const form = parseFlatForm(body, new Set([
    "_csrf",
    "expectedRowVersion",
    "previewDigest",
    "visibility"
  ]));
  return {
    csrf: required(form, "_csrf"),
    request: {
      expectedRowVersion: integer(form, "expectedRowVersion"),
      previewDigest: required(form, "previewDigest"),
      visibility: required(form, "visibility")
    }
  };
}

function parseFlatForm(body: unknown, allowed: ReadonlySet<string>): FlatForm {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw formError("Form data is required.");
  }
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [name, value] of Object.entries(body)) {
    if (!allowed.has(name)) {
      throw formError(`Unexpected form field '${name}'.`);
    }
    if (typeof value !== "string") {
      throw formError(`Form field '${name}' must occur exactly once.`);
    }
    values[name] = value;
  }
  return values;
}

function advancedConfiguration(form: FlatForm, kind: string) {
  if (kind !== "advanced") {
    throw formError("Configuration must select the main preset or advanced format.");
  }
  const podCount = boundedPositiveInteger(
    form,
    "configuration.value.podCount",
    MAXIMUM_ADVANCED_PODS
  );
  const podSize = integer(form, "configuration.value.podSize");
  return {
    kind: "advanced" as const,
    value: {
      formatVersion: TOURNAMENT_FORMAT_VERSION,
      formatType: POD_AND_SINGLE_ELIMINATION_FORMAT,
      teamCount: integer(form, "configuration.value.teamCount"),
      podCount,
      podSizes: Array.from({ length: Math.max(0, podCount) }, () => podSize),
      playersPerTeam: integer(form, "configuration.value.playersPerTeam"),
      gamesPerPair: integer(form, "configuration.value.gamesPerPair"),
      qualifiersPerPod: integer(form, "configuration.value.qualifiersPerPod"),
      bracketSize: integer(form, "configuration.value.bracketSize"),
      allowByes: form["configuration.value.allowByes"] === "true",
      standingsRules: OFFICIAL_STANDINGS_RULES
    }
  };
}

function boundedPositiveInteger(
  form: FlatForm,
  name: string,
  maximum: number
): number {
  const value = integer(form, name);
  if (value < 1 || value > maximum) {
    throw formError(`Form field '${name}' must be between 1 and ${maximum}.`);
  }
  return value;
}

function setupFieldNames(detail: AdminTournamentDetailResponse): Set<string> {
  const names = new Set(["_csrf", "expectedRowVersion"]);
  detail.pods.forEach((_pod, index) => {
    names.add(`pods.${index}.id`);
    names.add(`pods.${index}.name`);
  });
  for (let team = 0; team < detail.configuration.teamCount; team += 1) {
    ["id", "name", "podId", "initialSeed"].forEach((field) =>
      names.add(`teams.${team}.${field}`)
    );
    for (let player = 0; player < detail.configuration.playersPerTeam; player += 1) {
      ["id", "displayName", "firstName", "lastName", "preferredName"]
        .forEach((field) => names.add(`teams.${team}.players.${player}.${field}`));
    }
  }
  return names;
}

function required(form: FlatForm, name: string, trim = true): string {
  const raw = form[name];
  if (raw === undefined) {
    throw formError(`Form field '${name}' is required.`);
  }
  return trim ? raw.trim() : raw;
}

function integer(form: FlatForm, name: string): number {
  const value = Number(required(form, name));
  if (!Number.isSafeInteger(value)) {
    throw formError(`Form field '${name}' must be an integer.`);
  }
  return value;
}

function formError(message: string): AppError {
  return new AppError({
    code: "BAD_REQUEST",
    message,
    statusCode: HttpStatus.BAD_REQUEST
  });
}
