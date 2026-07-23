import { Module } from "@nestjs/common";

import {
  COMMENT_MODERATION_RULES,
  loadCommentModerationRules
} from "../config/comment-moderation-rules.config";
import {
  COMMENTS_CONFIG,
  CommentsConfig,
  loadCommentsConfig
} from "../config/comments.config";
import { CommentBodyNormalizer } from "./comment-body-normalizer";
import {
  COMMENT_MODERATION_POLICY,
  CommentModerationPolicy
} from "./comment-moderation.policy";
import {
  COMMENT_SUBMISSION_POLICY,
  DefaultCommentSubmissionPolicy
} from "./comment-submission.policy";
import { ConfiguredCommentModerationPolicy } from "./configured-comment-moderation.policy";

@Module({
  providers: [
    {
      provide: COMMENTS_CONFIG,
      useFactory: loadCommentsConfig
    },
    {
      provide: COMMENT_MODERATION_RULES,
      useFactory: (config: CommentsConfig) =>
        loadCommentModerationRules(config.moderationRulesPath),
      inject: [COMMENTS_CONFIG]
    },
    CommentBodyNormalizer,
    {
      provide: COMMENT_MODERATION_POLICY,
      useFactory: (
        rules: ReturnType<typeof loadCommentModerationRules>,
        normalizer: CommentBodyNormalizer
      ) => new ConfiguredCommentModerationPolicy(rules, normalizer),
      inject: [COMMENT_MODERATION_RULES, CommentBodyNormalizer]
    },
    {
      provide: COMMENT_SUBMISSION_POLICY,
      useFactory: (
        config: CommentsConfig,
        normalizer: CommentBodyNormalizer,
        moderation: CommentModerationPolicy
      ) => new DefaultCommentSubmissionPolicy(
        config,
        normalizer,
        moderation
      ),
      inject: [
        COMMENTS_CONFIG,
        CommentBodyNormalizer,
        COMMENT_MODERATION_POLICY
      ]
    }
  ],
  exports: [COMMENTS_CONFIG, COMMENT_SUBMISSION_POLICY]
})
export class CommentModerationModule {}
