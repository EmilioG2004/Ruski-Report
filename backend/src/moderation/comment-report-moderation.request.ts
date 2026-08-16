import { HttpStatus } from "@nestjs/common";

import { CommentReportStatus } from "../domain";
import { AppError } from "../errors";

export type ModerateCommentReportAction =
  | "mark_reviewed"
  | "dismiss"
  | "remove_comment";

export interface ModerateCommentReportRequest {
  action?: string;
  note?: string;
}

export function parseCommentReportStatus(
  value: string | undefined
): CommentReportStatus {
  const status = value ?? "open";
  if (status === "open" || status === "reviewed" || status === "resolved") {
    return status;
  }
  throw invalidModerationRequest(
    "COMMENT_REPORT_STATUS_INVALID",
    "status",
    "Select open, reviewed, or resolved."
  );
}

export function parseCommentReportAction(
  value: string | undefined
): ModerateCommentReportAction {
  if (
    value === "mark_reviewed" ||
    value === "dismiss" ||
    value === "remove_comment"
  ) {
    return value;
  }
  throw invalidModerationRequest(
    "COMMENT_REPORT_ACTION_INVALID",
    "action",
    "Select mark_reviewed, dismiss, or remove_comment."
  );
}

export function normalizeResolutionNote(
  value: string | undefined,
  maximumLength: number
): string | undefined {
  const note = value?.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (note === undefined || note.length === 0) {
    return undefined;
  }
  if (Array.from(note).length > maximumLength) {
    throw invalidModerationRequest(
      "COMMENT_REPORT_NOTE_TOO_LONG",
      "note",
      `Resolution notes must be ${maximumLength} characters or fewer.`
    );
  }
  return note;
}

function invalidModerationRequest(
  code: string,
  path: string,
  message: string
): AppError {
  return new AppError({
    code: "BAD_REQUEST",
    message,
    statusCode: HttpStatus.BAD_REQUEST,
    details: [{ code, message, path }]
  });
}
