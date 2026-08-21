import { HttpStatus } from "@nestjs/common";

import { AppError } from "../../errors";

export function invalidProjectionVersion(value: unknown): AppError {
  return new AppError({
    code: "BAD_REQUEST",
    statusCode: HttpStatus.BAD_REQUEST,
    message: "Projection version must be a positive safe integer.",
    details: [
      {
        code: "PROJECTION_VERSION_INVALID",
        message: "Projection version must be a positive safe integer.",
        path: "projectionVersion",
        metadata: { value: printableValue(value) }
      }
    ]
  });
}

export function publicResourceNotFound(
  detailCode:
    | "PUBLIC_TOURNAMENT_NOT_FOUND"
    | "PUBLIC_PROJECTION_NOT_FOUND"
    | "PUBLIC_MATCH_NOT_FOUND",
  path: "tournamentId" | "matchId" | "projectionVersion",
  value: string | number
): AppError {
  return new AppError({
    code: "NOT_FOUND",
    statusCode: HttpStatus.NOT_FOUND,
    message: publicNotFoundMessage(detailCode),
    details: [
      {
        code: detailCode,
        message: publicNotFoundMessage(detailCode),
        path,
        metadata: { value }
      }
    ]
  });
}

export function invalidMaterializedProjection(): AppError {
  return new AppError({
    code: "INTERNAL_ERROR",
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: "The public projection could not be loaded."
  });
}

export function publicProjectionReadFailure(cause: unknown): AppError {
  return new AppError({
    code: "INTERNAL_ERROR",
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: "The public projection could not be loaded.",
    cause: cause instanceof Error ? cause : undefined
  });
}

function publicNotFoundMessage(
  detailCode:
    | "PUBLIC_TOURNAMENT_NOT_FOUND"
    | "PUBLIC_PROJECTION_NOT_FOUND"
    | "PUBLIC_MATCH_NOT_FOUND"
): string {
  switch (detailCode) {
    case "PUBLIC_TOURNAMENT_NOT_FOUND":
      return "Public tournament was not found.";
    case "PUBLIC_PROJECTION_NOT_FOUND":
      return "Public projection version was not found.";
    case "PUBLIC_MATCH_NOT_FOUND":
      return "Public match was not found.";
  }
}

function printableValue(value: unknown): string | number | null {
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }

  return null;
}
