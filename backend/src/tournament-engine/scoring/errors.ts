import { CanonicalScoringValidationIssue } from "./contracts";

export class CanonicalScoringValidationError extends Error {
  constructor(readonly issues: readonly CanonicalScoringValidationIssue[]) {
    super(issues[0]?.message ?? "Canonical scoring validation failed.");
    this.name = "CanonicalScoringValidationError";
  }
}

export function scoringIssue(
  code: string,
  message: string,
  path?: string
): CanonicalScoringValidationIssue {
  return path === undefined ? { code, message } : { code, message, path };
}

export function rejectScoring(
  code: string,
  message: string,
  path?: string
): never {
  throw new CanonicalScoringValidationError([scoringIssue(code, message, path)]);
}
