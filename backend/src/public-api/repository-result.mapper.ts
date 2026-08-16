import { HttpStatus } from "@nestjs/common";

import { AppError } from "../errors";
import { RepositoryFailure, RepositoryResult } from "../repositories";

export function unwrapRepositoryResult<T>(
  result: RepositoryResult<T>,
  failureMessage: string
): T {
  if (result.ok) {
    return result.value;
  }

  throw new AppError({
    code: "PERSISTENCE_ERROR",
    message: failureMessage,
    details: [mapRepositoryFailure(result.error)]
  });
}

export function resourceNotFound(
  message: string,
  resource: string,
  resourceId: string
): AppError {
  return new AppError({
    code: "NOT_FOUND",
    message,
    statusCode: HttpStatus.NOT_FOUND,
    details: [
      {
        code: "RESOURCE_NOT_FOUND",
        message,
        path: resource,
        metadata: {
          resourceId
        }
      }
    ]
  });
}

function mapRepositoryFailure(failure: RepositoryFailure): {
  code: string;
  message: string;
  metadata?: Record<string, unknown>;
} {
  return {
    code: failure.code,
    message: failure.message,
    metadata: failure.metadata
  };
}
