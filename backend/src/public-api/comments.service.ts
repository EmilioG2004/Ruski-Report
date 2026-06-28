import { HttpStatus, Inject, Injectable } from "@nestjs/common";

import { commentsConfig, CommentsConfig } from "../config/comments.config";
import { AppError } from "../errors";
import {
  Comment,
  CommentAuthor,
  CommentAuthorKind,
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

export interface CreateCommentAuthorRequest {
  kind?: CommentAuthorKind;
  displayName?: string;
  userId?: string;
}

export interface CreateCommentRequest {
  body?: string;
  author?: CreateCommentAuthorRequest;
}

@Injectable()
export class CommentsService {
  private readonly config: CommentsConfig = commentsConfig;

  constructor(
    @Inject(COMMENT_REPOSITORY)
    private readonly commentRepository: CommentRepository,
    @Inject(TOURNAMENT_READ_REPOSITORY)
    private readonly tournamentReadRepository: TournamentReadRepository
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
    request: CreateCommentRequest | null | undefined
  ): Promise<Comment> {
    await this.requireMatch(matchId);

    const body = this.normalizeBody(request?.body);
    const author = this.normalizeAuthor(request?.author);

    return unwrapRepositoryResult(
      await this.commentRepository.create({
        matchId,
        author,
        body
      }),
      "Unable to create match comment."
    );
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

  private normalizeAuthor(
    author: CreateCommentAuthorRequest | undefined
  ): CommentAuthor {
    if (author === undefined || author.kind === undefined) {
      throw this.signInRequiredError();
    }

    if (author.kind === "guest") {
      throw this.signInRequiredError();
    }

    if (author.kind !== "account" && author.kind !== "admin") {
      throw new AppError({
        code: "BAD_REQUEST",
        message: "Comment author type is not supported.",
        statusCode: HttpStatus.BAD_REQUEST,
        details: [
          {
            code: "COMMENT_AUTHOR_UNSUPPORTED",
            message: "Comment author type is not supported.",
            path: "author.kind"
          }
        ]
      });
    }

    return {
      kind: author.kind,
      displayName: this.normalizeDisplayName(author.displayName),
      userId: author.userId?.trim() || undefined
    };
  }

  private normalizeDisplayName(displayName: string | undefined): string {
    const normalized = displayName?.trim() ?? "";

    if (normalized.length === 0) {
      return "Authenticated user";
    }

    return normalized;
  }

  private signInRequiredError(): AppError {
    return new AppError({
      code: "UNAUTHORIZED",
      message: "Sign in to post comments.",
      statusCode: HttpStatus.UNAUTHORIZED,
      details: [
        {
          code: "COMMENT_SIGN_IN_REQUIRED",
          message: "Sign in to post comments.",
          path: "author"
        }
      ]
    });
  }
}
