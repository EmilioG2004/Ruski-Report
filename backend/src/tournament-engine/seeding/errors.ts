import { SeedingValidationIssue } from "./contracts";

export class SeedingValidationError extends Error {
  constructor(readonly issues: readonly SeedingValidationIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "SeedingValidationError";
  }
}
