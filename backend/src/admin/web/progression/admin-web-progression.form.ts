import { HttpStatus } from "@nestjs/common";

import { AppError } from "../../../errors";
import { isStableUuid } from "../../../tournament-engine/domain";
import {
  ApplyAdminMatchResolutionRequest,
  FinalizeAdminPodRequest,
  OverrideAdminSeedOrderRequest,
  PreviewAdminBracketRequest,
  PreviewAdminMatchResolutionRequest,
  PublishAdminBracketRequest,
  ResolveAdminGlobalSeedTieRequest,
  ResolveAdminStandingTieRequest
} from "../../tournament-progression";

type FlatForm = Readonly<Record<string, string>>;

const DIGEST = /^[a-f0-9]{64}$/u;
const MATCH_COMMANDS = new Set(["forfeit", "cancel", "postpone"]);

export function parseMatchResolutionPreviewForm(body: unknown): {
  matchId: string;
  request: PreviewAdminMatchResolutionRequest;
} {
  const form = flatForm(body, new Set([
    "_csrf",
    "matchId",
    "expectedTournamentRowVersion",
    "expectedMatchRowVersion",
    "commandType",
    "winnerTeamId",
    "reason"
  ]));
  const commandType = required(form, "commandType");
  if (!MATCH_COMMANDS.has(commandType)) invalid("commandType");
  const winnerTeamId = optionalUuid(form, "winnerTeamId");
  if (commandType === "forfeit" && winnerTeamId === undefined) {
    invalid("winnerTeamId");
  }
  if (commandType !== "forfeit" && winnerTeamId !== undefined) {
    invalid("winnerTeamId");
  }
  return {
    matchId: uuid(form, "matchId"),
    request: {
      expectedTournamentRowVersion: positiveInteger(
        form,
        "expectedTournamentRowVersion"
      ),
      expectedMatchRowVersion: positiveInteger(form, "expectedMatchRowVersion"),
      commandType,
      ...(winnerTeamId === undefined ? {} : { winnerTeamId }),
      reason: reason(form)
    }
  };
}

export function parseMatchResolutionApplyForm(body: unknown): {
  request: ApplyAdminMatchResolutionRequest;
} {
  const form = flatForm(body, new Set([
    "_csrf",
    "expectedTournamentRowVersion",
    "expectedMatchRowVersion",
    "commandType",
    "winnerTeamId",
    "reason",
    "confirmationDigest",
    "cascadeConfirmationDigest"
  ]));
  const commandType = required(form, "commandType");
  if (!MATCH_COMMANDS.has(commandType)) invalid("commandType");
  const winnerTeamId = optionalUuid(form, "winnerTeamId");
  if (commandType === "forfeit" && winnerTeamId === undefined) {
    invalid("winnerTeamId");
  }
  if (commandType !== "forfeit" && winnerTeamId !== undefined) {
    invalid("winnerTeamId");
  }
  return {
    request: {
      expectedTournamentRowVersion: positiveInteger(
        form,
        "expectedTournamentRowVersion"
      ),
      expectedMatchRowVersion: positiveInteger(form, "expectedMatchRowVersion"),
      commandType,
      ...(winnerTeamId === undefined ? {} : { winnerTeamId }),
      reason: reason(form),
      confirmationDigest: digest(form),
      ...(form.cascadeConfirmationDigest === undefined
        ? {}
        : { cascadeConfirmationDigest: sha256(form, "cascadeConfirmationDigest") })
    }
  };
}

export function parsePodTieForm(body: unknown, confirmation: boolean): {
  request: ResolveAdminStandingTieRequest;
} {
  const form = resolutionForm(body, [
    "activeCalculationId",
    "tieGroupId",
    "orderedTeamIds",
    "reason"
  ], confirmation);
  return {
    request: {
      expectedTournamentRowVersion: positiveInteger(
        form,
        "expectedTournamentRowVersion"
      ),
      activeCalculationId: uuid(form, "activeCalculationId"),
      tieGroupId: sha256(form, "tieGroupId"),
      orderedTeamIds: uuidList(form, "orderedTeamIds"),
      reason: reason(form),
      ...(confirmation ? { confirmationDigest: digest(form) } : {})
    }
  };
}

export function parsePodFinalizationForm(
  body: unknown,
  confirmation: boolean
): { request: FinalizeAdminPodRequest } {
  const form = resolutionForm(
    body,
    ["calculationId", "reason"],
    confirmation
  );
  const optionalReason = reason(form, true);
  return {
    request: {
      expectedTournamentRowVersion: positiveInteger(
        form,
        "expectedTournamentRowVersion"
      ),
      calculationId: uuid(form, "calculationId"),
      ...(optionalReason.length === 0 ? {} : { reason: optionalReason }),
      ...(confirmation ? { confirmationDigest: digest(form) } : {})
    }
  };
}

export function parseGlobalSeedTieForm(
  body: unknown,
  confirmation: boolean
): { request: ResolveAdminGlobalSeedTieRequest } {
  const form = resolutionForm(body, [
    "activeReviewVersionId",
    "seedCalculationId",
    "tieGroupId",
    "orderedTeamIds",
    "reason"
  ], confirmation);
  return {
    request: {
      expectedTournamentRowVersion: positiveInteger(
        form,
        "expectedTournamentRowVersion"
      ),
      activeReviewVersionId: uuid(form, "activeReviewVersionId"),
      seedCalculationId: uuid(form, "seedCalculationId"),
      tieGroupId: uuid(form, "tieGroupId"),
      orderedTeamIds: uuidList(form, "orderedTeamIds"),
      reason: reason(form),
      ...(confirmation ? { confirmationDigest: digest(form) } : {})
    }
  };
}

export function parseSeedOverrideForm(
  body: unknown,
  confirmation: boolean
): { request: OverrideAdminSeedOrderRequest } {
  const form = resolutionForm(
    body,
    ["calculationId", "orderedTeamIds", "reason"],
    confirmation
  );
  return {
    request: {
      expectedTournamentRowVersion: positiveInteger(
        form,
        "expectedTournamentRowVersion"
      ),
      calculationId: uuid(form, "calculationId"),
      orderedTeamIds: uuidList(form, "orderedTeamIds"),
      reason: reason(form),
      ...(confirmation ? { confirmationDigest: digest(form) } : {})
    }
  };
}

export function parseBracketForm(
  body: unknown,
  confirmation: boolean
): { request: PreviewAdminBracketRequest | PublishAdminBracketRequest } {
  const form = resolutionForm(body, [], confirmation);
  return {
    request: {
      expectedTournamentRowVersion: positiveInteger(
        form,
        "expectedTournamentRowVersion"
      ),
      ...(confirmation ? { confirmationDigest: digest(form) } : {})
    }
  };
}

function resolutionForm(
  body: unknown,
  fields: readonly string[],
  confirmation: boolean
): FlatForm {
  return flatForm(body, new Set([
    "_csrf",
    "expectedTournamentRowVersion",
    ...fields,
    ...(confirmation ? ["confirmationDigest"] : [])
  ]));
}

function flatForm(body: unknown, allowed: ReadonlySet<string>): FlatForm {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    invalid("body");
  }
  const values: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const [name, value] of Object.entries(body)) {
    if (!allowed.has(name)) {
      throw formError(`Unexpected form field '${name}'.`, name);
    }
    if (typeof value !== "string") {
      throw formError(`Form field '${name}' must occur exactly once.`, name);
    }
    values[name] = value;
  }
  required(values, "_csrf");
  return values;
}

function required(form: FlatForm, name: string): string {
  const value = form[name]?.trim();
  if (value === undefined || value.length === 0) invalid(name);
  return value;
}

function uuid(form: FlatForm, name: string): string {
  const value = required(form, name);
  if (!isStableUuid(value)) invalid(name);
  return value.toLowerCase();
}

function optionalUuid(form: FlatForm, name: string): string | undefined {
  return form[name] === undefined || form[name]?.trim() === ""
    ? undefined
    : uuid(form, name);
}

function positiveInteger(form: FlatForm, name: string): number {
  const value = Number(required(form, name));
  if (!Number.isSafeInteger(value) || value <= 0) invalid(name);
  return value;
}

function uuidList(form: FlatForm, name: string): string[] {
  const values = required(form, name)
    .split(/[\s,]+/u)
    .filter((value) => value.length > 0)
    .map((value) => value.toLowerCase());
  if (values.length === 0 || values.some((value) => !isStableUuid(value)) ||
      new Set(values).size !== values.length) {
    invalid(name);
  }
  return values;
}

function reason(form: FlatForm, optional = false): string {
  const value = form.reason?.trim() ?? "";
  if (optional && value.length === 0) return "";
  if (value.length < 3 || value.length > 500) invalid("reason");
  return value;
}

function digest(form: FlatForm): string {
  return sha256(form, "confirmationDigest");
}

function sha256(form: FlatForm, name: string): string {
  const value = required(form, name);
  if (!DIGEST.test(value)) invalid(name);
  return value;
}

function invalid(path: string): never {
  throw formError("Tournament progression form is invalid.", path);
}

function formError(message: string, path: string): AppError {
  return new AppError({
    code: "BAD_REQUEST",
    message,
    statusCode: HttpStatus.BAD_REQUEST,
    details: [{
      code: "ADMIN_PROGRESSION_FORM_INVALID",
      path,
      message: "Review this progression value."
    }]
  });
}
