import { HttpStatus, Inject, Injectable } from "@nestjs/common";

import {
  COMMENT_SUBMISSION_POLICY,
  CommentSubmissionPolicy,
  CommentSubmissionRejectionReason
} from "../comments";
import { COMMENTS_CONFIG, CommentsConfig } from "../config/comments.config";
import { AppError } from "../errors";
import {
  AuthenticatedPrincipal,
  Comment,
  MatchDetail
} from "../domain";
import {
  COMMENT_REPOSITORY,
  CommentRepository,
  TOURNAMENT_READ_REPOSITORY,
  TRANSACTION_MANAGER,
  TransactionManager,
  TournamentReadRepository
} from "../repositories";
import {
  resourceNotFound,
  unwrapRepositoryResult
} from "./repository-result.mapper";
import { RealtimeUpdatePublisher } from "../realtime";
import { APP_LOGGER, AppLogger } from "../logging";
import { PUBLIC_PROJECTION_READ_REPOSITORY } from
  "./v2/public-projection-read.repository";
import type {
  PublicProjectionReadRepository,
  VisiblePublicMatchReference
} from "./v2/public-projection-read.repository";

export interface CreateCommentRequest {
  body?: string;
}

@Injectable()
export class CommentsService {
  constructor(
    @Inject(COMMENT_REPOSITORY)
    private readonly commentRepository: CommentRepository,
    @Inject(TOURNAMENT_READ_REPOSITORY)
    private readonly tournamentReadRepository: TournamentReadRepository,
    @Inject(PUBLIC_PROJECTION_READ_REPOSITORY)
    private readonly publicProjectionReadRepository: PublicProjectionReadRepository,
    @Inject(TRANSACTION_MANAGER)
    private readonly transactions: TransactionManager,
    private readonly realtimeUpdates: RealtimeUpdatePublisher,
    @Inject(COMMENT_SUBMISSION_POLICY)
    private readonly submissionPolicy: CommentSubmissionPolicy,
    @Inject(COMMENTS_CONFIG)
    private readonly config: CommentsConfig,
    @Inject(APP_LOGGER)
    private readonly logger: AppLogger
  ) {}

  async getMatchComments(
    matchId: string,
    principal?: AuthenticatedPrincipal
  ): Promise<Comment[]> {
    await this.requireMatch(matchId);

    return unwrapRepositoryResult(
      await this.commentRepository.findByMatchId(matchId, principal?.userId),
      "Unable to load match comments."
    );
  }

  async createMatchComment(
    matchId: string,
    request: CreateCommentRequest | null | undefined,
    principal: AuthenticatedPrincipal
  ): Promise<Comment> {
    const match = await this.requireMatch(matchId);
    const submission = this.submissionPolicy.evaluate(request?.body);

    if (submission.status === "rejected") {
      this.logModerationDecision(
        matchId,
        submission.reason,
        submission.bodyCharacterCount,
        submission.ruleId
      );
      throw commentSubmissionError(submission.reason, this.config);
    }

    this.logger.info("Comment moderation allowed submission.", {
      component: CommentsService.name,
      operation: "createMatchComment",
      matchId,
      metadata: {
        decision: "allowed",
        bodyCharacterCount: submission.body.characterCount
      }
    });

    const creation = await this.transactions.runInTransaction(
      async (transaction) =>
        unwrapRepositoryResult(
          await this.commentRepository.createUnlessRecentDuplicate(
            {
              matchId,
              author: {
                kind: "account",
                displayName: principal.displayName,
                userId: principal.userId
              },
              body: submission.body.value,
              normalizedBodyHash: submission.body.fingerprint
            },
            this.earliestDuplicateCreatedAt(),
            transaction
          ),
          "Unable to create match comment."
        )
    );

    if (creation.status === "duplicate") {
      this.logModerationDecision(
        matchId,
        "recently_repeated",
        submission.body.characterCount
      );
      throw repeatedCommentError();
    }

    const comment = creation.comment;
    this.realtimeUpdates.publishCommentsUpdated({
      tournamentId: match.tournamentId,
      matchId,
      ...("projectionVersion" in match
        ? { projectionVersion: match.projectionVersion }
        : {}),
      metadata: {
        commentId: comment.id
      }
    });

    return comment;
  }

  private async requireMatch(
    matchId: string
  ): Promise<Pick<MatchDetail, "id" | "tournamentId"> | VisiblePublicMatchReference> {
    const match = unwrapRepositoryResult(
      await this.tournamentReadRepository.findMatchDetail(matchId),
      "Unable to load match detail."
    );

    if (match !== null) {
      return match;
    }

    const canonicalMatch = await this.publicProjectionReadRepository
      .findVisibleMatchReference(matchId);
    if (canonicalMatch !== null) {
      return canonicalMatch;
    }

    throw resourceNotFound("Match was not found.", "matchId", matchId);
  }

  private earliestDuplicateCreatedAt(): string {
    return new Date(
      Date.now() - this.config.duplicateWindowSeconds * 1000
    ).toISOString();
  }

  private logModerationDecision(
    matchId: string,
    reason: CommentSubmissionRejectionReason | "recently_repeated",
    bodyCharacterCount: number,
    ruleId?: string
  ): void {
    this.logger.warning("Comment submission rejected.", {
      component: CommentsService.name,
      operation: "createMatchComment",
      matchId,
      metadata: {
        decision: "rejected",
        reason,
        bodyCharacterCount,
        ruleId
      }
    });
  }
}

function commentSubmissionError(
  reason: CommentSubmissionRejectionReason,
  config: CommentsConfig
): AppError {
  switch (reason) {
    case "body_required":
      return new AppError({
        code: "BAD_REQUEST",
        message: "Comment body is required.",
        statusCode: HttpStatus.BAD_REQUEST,
        details: [
          {
            code: "COMMENT_BODY_REQUIRED",
            message: "Comment body is required.",
            path: "body"
          }
        ]
      });
    case "body_too_long": {
      const message =
        `Comments must be ${config.maximumBodyLength} characters or fewer.`;
      return new AppError({
        code: "BAD_REQUEST",
        message,
        statusCode: HttpStatus.BAD_REQUEST,
        details: [
          {
            code: "COMMENT_BODY_TOO_LONG",
            message,
            path: "body",
            metadata: {
              maximumBodyLength: config.maximumBodyLength
            }
          }
        ]
      });
    }
    case "content_not_allowed":
      return new AppError({
        code: "VALIDATION_FAILED",
        message:
          "This comment cannot be posted because it violates the community standards.",
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        details: [
          {
            code: "COMMENT_CONTENT_NOT_ALLOWED",
            message:
              "Edit the comment so it follows the community standards.",
            path: "body"
          }
        ]
      });
    case "spam_detected":
      return new AppError({
        code: "VALIDATION_FAILED",
        message: "This comment looks like spam.",
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        details: [
          {
            code: "COMMENT_SPAM_DETECTED",
            message: "Edit the comment and try again.",
            path: "body"
          }
        ]
      });
  }
}

function repeatedCommentError(): AppError {
  return new AppError({
    code: "CONFLICT",
    message: "You recently posted this comment.",
    statusCode: HttpStatus.CONFLICT,
    details: [
      {
        code: "COMMENT_RECENTLY_REPEATED",
        message: "Wait before posting the same comment again.",
        path: "body"
      }
    ]
  });
}
