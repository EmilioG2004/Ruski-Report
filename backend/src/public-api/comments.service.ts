import { HttpStatus, Inject, Injectable } from "@nestjs/common";

import { commentsConfig, CommentsConfig } from "../config/comments.config";
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
  TournamentReadRepository
} from "../repositories";
import {
  resourceNotFound,
  unwrapRepositoryResult
} from "./repository-result.mapper";
import { RealtimeUpdatePublisher } from "../realtime";

export interface CreateCommentRequest {
  body?: string;
}

@Injectable()
export class CommentsService {
  private readonly config: CommentsConfig = commentsConfig;

  constructor(
    @Inject(COMMENT_REPOSITORY)
    private readonly commentRepository: CommentRepository,
    @Inject(TOURNAMENT_READ_REPOSITORY)
    private readonly tournamentReadRepository: TournamentReadRepository,
    private readonly realtimeUpdates: RealtimeUpdatePublisher
  ) {}

  async getMatchComments(matchId: string): Promise<Comment[]> {
    await this.requireMatch(matchId);

    return unwrapRepositoryResult(
      await this.commentRepository.findByMatchId(matchId),
      "Unable to load match comments."
    );
  }

  async createMatchComment(
    matchId: string,
    request: CreateCommentRequest | null | undefined,
    principal: AuthenticatedPrincipal
  ): Promise<Comment> {
    const match = await this.requireMatch(matchId);

    const body = this.normalizeBody(request?.body);
    const comment = unwrapRepositoryResult(
      await this.commentRepository.create({
        matchId,
        author: {
          kind: "account",
          displayName: principal.displayName,
          userId: principal.userId
        },
        body
      }),
      "Unable to create match comment."
    );

    this.realtimeUpdates.publishCommentsUpdated({
      tournamentId: match.tournamentId,
      matchId,
      metadata: {
        commentId: comment.id
      }
    });

    return comment;
  }

  private async requireMatch(matchId: string): Promise<MatchDetail> {
    const match = unwrapRepositoryResult(
      await this.tournamentReadRepository.findMatchDetail(matchId),
      "Unable to load match detail."
    );

    if (match === null) {
      throw resourceNotFound("Match was not found.", "matchId", matchId);
    }

    return match;
  }

  private normalizeBody(body: string | undefined): string {
    const normalized = body?.trim() ?? "";

    if (normalized.length === 0) {
      throw new AppError({
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
    }

    if (normalized.length > this.config.maxBodyLength) {
      throw new AppError({
        code: "BAD_REQUEST",
        message: `Comments must be ${this.config.maxBodyLength} characters or fewer.`,
        statusCode: HttpStatus.BAD_REQUEST,
        details: [
          {
            code: "COMMENT_BODY_TOO_LONG",
            message: `Comments must be ${this.config.maxBodyLength} characters or fewer.`,
            path: "body",
            metadata: {
              maxBodyLength: this.config.maxBodyLength
            }
          }
        ]
      });
    }

    return normalized;
  }

}
