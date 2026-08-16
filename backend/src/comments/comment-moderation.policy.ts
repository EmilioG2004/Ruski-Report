import { NormalizedCommentBody } from "./comment-body-normalizer";

export const COMMENT_MODERATION_POLICY = Symbol("COMMENT_MODERATION_POLICY");

export type CommentModerationDecision =
  | { status: "allowed" }
  | {
      status: "rejected";
      reason: "blocked_phrase";
      ruleId: string;
    };

export interface CommentModerationPolicy {
  evaluate(body: NormalizedCommentBody): CommentModerationDecision;
}
