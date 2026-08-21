import { BracketValidationIssue } from "./contracts";

export class BracketValidationError extends Error {
  constructor(readonly issues: readonly BracketValidationIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "BracketValidationError";
  }
}
