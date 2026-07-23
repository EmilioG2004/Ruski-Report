import {
  COMMENT_REPORT_REASONS,
  CommentReportReason
} from "../domain";
import { CommentReportingConfig } from "../config/comment-reporting.config";

export const COMMENT_REPORT_POLICY = Symbol("COMMENT_REPORT_POLICY");

export interface SubmitCommentReportRequest {
  reason?: string;
  context?: string;
}

export type CommentReportPolicyDecision =
  | {
      status: "accepted";
      reason: CommentReportReason;
      context?: string;
    }
  | {
      status: "rejected";
      reason:
        | "reason_required"
        | "reason_invalid"
        | "context_required"
        | "context_too_long";
      contextCharacterCount: number;
    };

export interface CommentReportPolicy {
  evaluate(
    request: SubmitCommentReportRequest | null | undefined
  ): CommentReportPolicyDecision;
}

export class DefaultCommentReportPolicy implements CommentReportPolicy {
  constructor(private readonly config: CommentReportingConfig) {}

  evaluate(
    request: SubmitCommentReportRequest | null | undefined
  ): CommentReportPolicyDecision {
    const context = normalizeContext(request?.context);
    const contextCharacterCount = Array.from(context ?? "").length;
    const rawReason = request?.reason?.trim();

    if (rawReason === undefined || rawReason.length === 0) {
      return {
        status: "rejected",
        reason: "reason_required",
        contextCharacterCount
      };
    }
    if (!isCommentReportReason(rawReason)) {
      return {
        status: "rejected",
        reason: "reason_invalid",
        contextCharacterCount
      };
    }
    if (rawReason === "other" && context === undefined) {
      return {
        status: "rejected",
        reason: "context_required",
        contextCharacterCount
      };
    }
    if (contextCharacterCount > this.config.maximumContextLength) {
      return {
        status: "rejected",
        reason: "context_too_long",
        contextCharacterCount
      };
    }

    return {
      status: "accepted",
      reason: rawReason,
      context
    };
  }
}

function normalizeContext(value: string | undefined): string | undefined {
  const normalized = value
    ?.normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[^\S\n]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}

function isCommentReportReason(value: string): value is CommentReportReason {
  return (COMMENT_REPORT_REASONS as readonly string[]).includes(value);
}
