import { HttpStatus } from "@nestjs/common";

import { CommentReportingConfig } from "../config/comment-reporting.config";
import { AppError } from "../errors";
import { CommentReportPolicyDecision } from "./comment-report.policy";

export function invalidCommentReportError(
  reason: Extract<
    CommentReportPolicyDecision,
    { status: "rejected" }
  >["reason"],
  config: CommentReportingConfig
): AppError {
  const definitions = {
    reason_required: {
      code: "COMMENT_REPORT_REASON_REQUIRED",
      message: "Select a reason for the report.",
      path: "reason"
    },
    reason_invalid: {
      code: "COMMENT_REPORT_REASON_INVALID",
      message: "Select a supported report reason.",
      path: "reason"
    },
    context_required: {
      code: "COMMENT_REPORT_CONTEXT_REQUIRED",
      message: "Add context when selecting Other.",
      path: "context"
    },
    context_too_long: {
      code: "COMMENT_REPORT_CONTEXT_TOO_LONG",
      message:
        `Report context must be ${config.maximumContextLength} characters or fewer.`,
      path: "context",
      metadata: {
        maximumContextLength: config.maximumContextLength
      }
    }
  } as const;
  const detail = definitions[reason];
  return new AppError({
    code: "BAD_REQUEST",
    message: detail.message,
    statusCode: HttpStatus.BAD_REQUEST,
    details: [detail]
  });
}

export function commentUnavailableError(commentId: string): AppError {
  return new AppError({
    code: "NOT_FOUND",
    message: "This comment is no longer available.",
    statusCode: HttpStatus.NOT_FOUND,
    details: [
      {
        code: "COMMENT_NOT_AVAILABLE",
        message: "Refresh the comments and try again.",
        path: "commentId",
        metadata: { commentId }
      }
    ]
  });
}

export function commentReportRateLimitedError(
  retryAfterSeconds: number
): AppError {
  return new AppError({
    code: "RATE_LIMITED",
    message: "Too many comment reports were submitted.",
    statusCode: HttpStatus.TOO_MANY_REQUESTS,
    details: [
      {
        code: "COMMENT_REPORT_RATE_LIMITED",
        message: "Wait before submitting another report.",
        metadata: { retryAfterSeconds }
      }
    ]
  });
}
