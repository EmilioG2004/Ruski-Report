import { CommentModerationRules } from "../config/comment-moderation-rules.config";
import { CommentBodyNormalizer, NormalizedCommentBody } from "./comment-body-normalizer";
import {
  CommentModerationDecision,
  CommentModerationPolicy
} from "./comment-moderation.policy";

interface CompiledBlockedPhrase {
  ruleId: string;
  comparisonValue: string;
}

export class ConfiguredCommentModerationPolicy
  implements CommentModerationPolicy
{
  private readonly blockedPhrases: readonly CompiledBlockedPhrase[];

  constructor(
    rules: CommentModerationRules,
    normalizer: CommentBodyNormalizer
  ) {
    this.blockedPhrases = rules.blockedPhrases.map((phrase, index) => ({
      ruleId: `blocked-phrase-${index + 1}`,
      comparisonValue: normalizer.comparisonValue(phrase)
    }));

    if (this.blockedPhrases.some((rule) => rule.comparisonValue.length === 0)) {
      throw new Error(
        "Blocked comment phrases must contain at least one letter or number."
      );
    }
  }

  evaluate(body: NormalizedCommentBody): CommentModerationDecision {
    const candidate = ` ${body.comparisonValue} `;
    const blockedPhrase = this.blockedPhrases.find((rule) =>
      candidate.includes(` ${rule.comparisonValue} `)
    );

    return blockedPhrase === undefined
      ? { status: "allowed" }
      : {
          status: "rejected",
          reason: "blocked_phrase",
          ruleId: blockedPhrase.ruleId
        };
  }
}
