import { AppError } from "../errors";
import { RepositoryResult } from "../repositories";

export function requireAuthRepositoryValue<T>(
  result: RepositoryResult<T>,
  failureMessage: string
): T {
  if (result.ok) {
    return result.value;
  }

  throw new AppError({
    code: "PERSISTENCE_ERROR",
    message: failureMessage,
    details: [
      {
        code: result.error.code,
        message: result.error.message,
        metadata: result.error.metadata
      }
    ]
  });
}
