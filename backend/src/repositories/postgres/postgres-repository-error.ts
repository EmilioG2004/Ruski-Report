import { DatabaseError } from "pg";

import { RepositoryFailure } from "../repository-result";

export function mapPostgresError(
  error: unknown,
  message: string
): RepositoryFailure {
  if (error instanceof DatabaseError) {
    return {
      code: error.code === "23505" ? "conflict" : "storage_failed",
      message,
      metadata: {
        sqlState: error.code,
        constraint: error.constraint
      }
    };
  }

  return {
    code: "storage_failed",
    message,
    metadata: {
      reason: error instanceof Error ? error.message : String(error)
    }
  };
}
