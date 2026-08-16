import { CommentsConfig } from "../config/comments.config";
import {
  CommentBodyNormalizer,
  NormalizedCommentBody
} from "./comment-body-normalizer";
import { CommentModerationPolicy } from "./comment-moderation.policy";

export const COMMENT_SUBMISSION_POLICY = Symbol("COMMENT_SUBMISSION_POLICY");

export type CommentSubmissionRejectionReason =
  | "body_required"
  | "body_too_long"
  | "content_not_allowed"
  | "spam_detected";

export type CommentSubmissionDecision =
  | {
      status: "accepted";
      body: NormalizedCommentBody;
    }
  | {
      status: "rejected";
      reason: CommentSubmissionRejectionReason;
      bodyCharacterCount: number;
      ruleId?: string;
    };

type RejectedCommentSubmissionDecision = Extract<
  CommentSubmissionDecision,
  { status: "rejected" }
>;

export interface CommentSubmissionPolicy {
  evaluate(body: string | undefined): CommentSubmissionDecision;
}

export class DefaultCommentSubmissionPolicy
  implements CommentSubmissionPolicy
{
  constructor(
    private readonly config: CommentsConfig,
    private readonly normalizer: CommentBodyNormalizer,
    private readonly moderation: CommentModerationPolicy
  ) {}

  evaluate(body: string | undefined): CommentSubmissionDecision {
    const normalized = this.normalizer.normalize(body);

    if (normalized.characterCount === 0) {
      return this.rejected("body_required", normalized);
    }

    if (normalized.characterCount > this.config.maximumBodyLength) {
      return this.rejected("body_too_long", normalized);
    }

    const moderationDecision = this.moderation.evaluate(normalized);
    if (moderationDecision.status === "rejected") {
      return {
        ...this.rejected("content_not_allowed", normalized),
        ruleId: moderationDecision.ruleId
      };
    }

    if (this.isSpamLike(normalized)) {
      return this.rejected("spam_detected", normalized);
    }

    return {
      status: "accepted",
      body: normalized
    };
  }

  private rejected(
    reason: CommentSubmissionRejectionReason,
    body: NormalizedCommentBody
  ): RejectedCommentSubmissionDecision {
    return {
      status: "rejected",
      reason,
      bodyCharacterCount: body.characterCount
    };
  }

  private isSpamLike(body: NormalizedCommentBody): boolean {
    return (
      countLinks(body.value) > this.config.maximumLinks ||
      longestCharacterRun(body.value) >
        this.config.maximumRepeatedCharacterRun ||
      longestRepeatedTokenRun(body.comparisonValue) >
        this.config.maximumRepeatedTokenCount
    );
  }
}

function countLinks(value: string): number {
  return Array.from(
    value.matchAll(/(?:https?:\/\/|www\.)\S+/giu)
  ).length;
}

function longestCharacterRun(value: string): number {
  let longest = 0;
  let current = 0;
  let previous: string | undefined;

  for (const character of value.toLocaleLowerCase("en-US")) {
    if (character === previous && !/\s/u.test(character)) {
      current += 1;
    } else {
      previous = character;
      current = 1;
    }
    longest = Math.max(longest, current);
  }

  return longest;
}

function longestRepeatedTokenRun(comparisonValue: string): number {
  let longest = 0;
  let current = 0;
  let previous: string | undefined;

  for (const token of comparisonValue.split(" ").filter(Boolean)) {
    if (token === previous) {
      current += 1;
    } else {
      previous = token;
      current = 1;
    }
    longest = Math.max(longest, current);
  }

  return longest;
}
