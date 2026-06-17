import { Metadata } from "../domain";

export type RepositoryFailureCode =
  | "not_found"
  | "conflict"
  | "validation_failed"
  | "transaction_failed"
  | "storage_failed";

export interface RepositoryFailure {
  code: RepositoryFailureCode;
  message: string;
  metadata?: Metadata;
}

export type RepositoryResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: RepositoryFailure;
    };

export function repositorySuccess<T>(value: T): RepositoryResult<T> {
  return {
    ok: true,
    value
  };
}

export function repositoryFailure<T = never>(
  error: RepositoryFailure
): RepositoryResult<T> {
  return {
    ok: false,
    error
  };
}
