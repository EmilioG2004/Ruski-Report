import { WorkbookIssue } from "./types";

export class CanonicalWorkbookSafetyError extends Error {
  constructor(
    message: string,
    readonly issue: WorkbookIssue
  ) {
    super(message);
    this.name = "CanonicalWorkbookSafetyError";
  }
}

export class WorkbookApplyPlanningError extends Error {
  constructor(
    message: string,
    readonly issues: readonly WorkbookIssue[]
  ) {
    super(message);
    this.name = "WorkbookApplyPlanningError";
  }
}
