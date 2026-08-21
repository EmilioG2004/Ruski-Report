import { AppError } from "../../errors";
import { isStableUuid } from "../../tournament-engine/domain";
import {
  AdminOperatorMatchCommand,
  ApplyAdminMatchResolutionRequest,
  FinalizeAdminPodRequest,
  OverrideAdminSeedOrderRequest,
  PreviewAdminBracketRequest,
  PreviewAdminMatchResolutionRequest,
  PublishAdminBracketRequest,
  ResolveAdminGlobalSeedTieRequest,
  ResolveAdminStandingTieRequest
} from "./admin-tournament-progression.contracts";

const DIGEST = /^[a-f0-9]{64}$/u;
const COMMANDS = new Set<AdminOperatorMatchCommand>([
  "forfeit",
  "cancel",
  "postpone"
]);

export function parseMatchResolutionPreview(
  input: PreviewAdminMatchResolutionRequest | null | undefined
) {
  const body = object(input);
  const commandType = string(body, "commandType");
  if (!COMMANDS.has(commandType as AdminOperatorMatchCommand)) {
    invalid("commandType", "MATCH_RESOLUTION_COMMAND_INVALID");
  }
  const winnerTeamId = optionalUuid(body, "winnerTeamId");
  if (commandType === "forfeit" && winnerTeamId === undefined) {
    invalid("winnerTeamId", "FORFEIT_WINNER_REQUIRED");
  }
  if (commandType !== "forfeit" && winnerTeamId !== undefined) {
    invalid("winnerTeamId", "MATCH_RESOLUTION_WINNER_NOT_ALLOWED");
  }
  return {
    expectedTournamentRowVersion: positiveInteger(body, "expectedTournamentRowVersion"),
    expectedMatchRowVersion: positiveInteger(body, "expectedMatchRowVersion"),
    commandType: commandType as AdminOperatorMatchCommand,
    ...(winnerTeamId === undefined ? {} : { winnerTeamId }),
    reason: reason(body)
  };
}

export function parseMatchResolutionApply(
  input: ApplyAdminMatchResolutionRequest | null | undefined
) {
  return {
    ...parseMatchResolutionPreview(input),
    confirmationDigest: digest(object(input), "confirmationDigest"),
    ...(object(input).cascadeConfirmationDigest === undefined
      ? {}
      : {
          cascadeConfirmationDigest: digest(
            object(input),
            "cascadeConfirmationDigest"
          )
        })
  };
}

export function parsePodTieResolution(
  input: ResolveAdminStandingTieRequest | null | undefined
) {
  const body = object(input);
  return {
    expectedTournamentRowVersion: positiveInteger(body, "expectedTournamentRowVersion"),
    activeCalculationId: uuid(body, "activeCalculationId"),
    tieGroupId: digest(body, "tieGroupId"),
    orderedTeamIds: uuidList(body, "orderedTeamIds"),
    reason: reason(body),
    confirmationDigest: digest(body, "confirmationDigest")
  };
}

export function parsePodFinalization(
  input: FinalizeAdminPodRequest | null | undefined
) {
  const body = object(input);
  return {
    expectedTournamentRowVersion: positiveInteger(body, "expectedTournamentRowVersion"),
    calculationId: uuid(body, "calculationId"),
    reason: optionalReason(body),
    confirmationDigest: digest(body, "confirmationDigest")
  };
}

export function parseGlobalSeedTieResolution(
  input: ResolveAdminGlobalSeedTieRequest | null | undefined
) {
  const body = object(input);
  return {
    expectedTournamentRowVersion: positiveInteger(body, "expectedTournamentRowVersion"),
    activeReviewVersionId: uuid(body, "activeReviewVersionId"),
    seedCalculationId: uuid(body, "seedCalculationId"),
    tieGroupId: uuid(body, "tieGroupId"),
    orderedTeamIds: uuidList(body, "orderedTeamIds"),
    reason: reason(body),
    confirmationDigest: digest(body, "confirmationDigest")
  };
}

export function parseSeedOverride(
  input: OverrideAdminSeedOrderRequest | null | undefined
) {
  const body = object(input);
  return {
    expectedTournamentRowVersion: positiveInteger(body, "expectedTournamentRowVersion"),
    calculationId: uuid(body, "calculationId"),
    orderedTeamIds: uuidList(body, "orderedTeamIds"),
    reason: reason(body),
    confirmationDigest: digest(body, "confirmationDigest")
  };
}

export function parseBracketPreview(
  input: PreviewAdminBracketRequest | null | undefined
) {
  const body = object(input);
  return {
    expectedTournamentRowVersion: positiveInteger(body, "expectedTournamentRowVersion")
  };
}

export function parseBracketPublication(
  input: PublishAdminBracketRequest | null | undefined
) {
  return {
    ...parseBracketPreview(input),
    confirmationDigest: digest(object(input), "confirmationDigest")
  };
}

function object(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    invalid("body", "PROGRESSION_REQUEST_INVALID");
  }
  return input as Record<string, unknown>;
}

function string(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string") invalid(field, "PROGRESSION_FIELD_INVALID");
  return value.trim();
}

function positiveInteger(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    invalid(field, "PROGRESSION_VERSION_INVALID");
  }
  return Number(value);
}

function uuid(body: Record<string, unknown>, field: string): string {
  const value = string(body, field);
  if (!isStableUuid(value)) invalid(field, "PROGRESSION_ID_INVALID");
  return value.toLowerCase();
}

function optionalUuid(
  body: Record<string, unknown>,
  field: string
): string | undefined {
  if (body[field] === undefined || body[field] === null || body[field] === "") {
    return undefined;
  }
  return uuid(body, field);
}

function uuidList(body: Record<string, unknown>, field: string): string[] {
  const value = body[field];
  if (!Array.isArray(value) || value.length === 0 ||
      value.some((item) => typeof item !== "string" || !isStableUuid(item)) ||
      new Set(value.map((item) => item.toLowerCase())).size !== value.length) {
    invalid(field, "PROGRESSION_ID_ORDER_INVALID");
  }
  return value.map((item) => (item as string).toLowerCase());
}

function reason(body: Record<string, unknown>): string {
  const value = string(body, "reason");
  if (value.length < 3 || value.length > 500) {
    invalid("reason", "PROGRESSION_REASON_INVALID");
  }
  return value;
}

function optionalReason(body: Record<string, unknown>): string | undefined {
  if (body.reason === undefined || body.reason === null || body.reason === "") {
    return undefined;
  }
  return reason(body);
}

function digest(body: Record<string, unknown>, field: string): string {
  const value = string(body, field);
  if (!DIGEST.test(value)) invalid(field, "PROGRESSION_DIGEST_INVALID");
  return value;
}

function invalid(path: string, code: string): never {
  throw new AppError({
    code: "VALIDATION_FAILED",
    message: "Tournament progression request is invalid.",
    statusCode: 422,
    details: [{ path, code, message: "Invalid tournament progression value." }]
  });
}
