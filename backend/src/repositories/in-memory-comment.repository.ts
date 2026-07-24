import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { Comment, CommentId, MatchId } from "../domain";
import {
  CommentRepository,
  CreateCommentInput,
  CreateCommentResult
} from "./comment-repository";
import {
  repositoryFailure,
  repositorySuccess,
  RepositoryResult
} from "./repository-result";
import { TransactionContext } from "./transaction";

@Injectable()
export class InMemoryCommentRepository implements CommentRepository {
  private comments: Comment[] = [];
  private readonly normalizedBodyHashes = new Map<CommentId, string>();

  constructor(
    private readonly isAuthorBlocked: (
      viewerUserId: string,
      authorUserId: string
    ) => boolean = () => false
  ) {}

  async findByMatchId(
    matchId: MatchId,
    viewerUserId?: string
  ): Promise<RepositoryResult<Comment[]>> {
    return repositorySuccess(
      clone(
        this.comments.filter(
          (comment) =>
            comment.matchId === matchId &&
            comment.deletedAt === undefined &&
            !this.isBlockedComment(comment, viewerUserId)
        )
      )
    );
  }

  private isBlockedComment(
    comment: Comment,
    viewerUserId: string | undefined
  ): boolean {
    const authorUserId = comment.author.userId;
    return (
      viewerUserId !== undefined &&
      authorUserId !== undefined &&
      this.isAuthorBlocked(viewerUserId, authorUserId)
    );
  }

  async findById(
    commentId: CommentId,
    _transaction?: TransactionContext
  ): Promise<RepositoryResult<Comment | null>> {
    const comment = this.comments.find(
      (candidate) =>
        candidate.id === commentId && candidate.deletedAt === undefined
    );
    return repositorySuccess(comment === undefined ? null : clone(comment));
  }

  async findByIdForUpdate(
    commentId: CommentId,
    transaction: TransactionContext
  ): Promise<RepositoryResult<Comment | null>> {
    return this.findById(commentId, transaction);
  }

  async create(
    input: CreateCommentInput,
    _transaction?: TransactionContext
  ): Promise<RepositoryResult<Comment>> {
    const now = new Date().toISOString();
    const comment: Comment = {
      id: `comment-${randomUUID()}`,
      matchId: input.matchId,
      author: clone(input.author),
      body: input.body,
      createdAt: now
    };

    this.comments = [...this.comments, comment];
    if (input.normalizedBodyHash !== undefined) {
      this.normalizedBodyHashes.set(comment.id, input.normalizedBodyHash);
    }
    return repositorySuccess(clone(comment));
  }

  async createUnlessRecentDuplicate(
    input: CreateCommentInput,
    earliestDuplicateCreatedAt: string,
    _transaction: TransactionContext
  ): Promise<RepositoryResult<CreateCommentResult>> {
    const duplicate = this.comments.some(
      (comment) =>
        comment.deletedAt === undefined &&
        comment.matchId === input.matchId &&
        comment.author.userId === input.author.userId &&
        input.normalizedBodyHash !== undefined &&
        this.normalizedBodyHashes.get(comment.id) === input.normalizedBodyHash &&
        comment.createdAt >= earliestDuplicateCreatedAt
    );

    if (duplicate) {
      return repositorySuccess({ status: "duplicate" });
    }

    const created = await this.create(input);
    return created.ok
      ? repositorySuccess({
          status: "created",
          comment: created.value
        })
      : created;
  }

  async delete(
    commentId: CommentId,
    _transaction?: TransactionContext
  ): Promise<RepositoryResult<Comment>> {
    const comment = this.comments.find((candidate) => candidate.id === commentId);

    if (comment === undefined) {
      return repositoryFailure({
        code: "not_found",
        message: `Comment "${commentId}" was not found.`
      });
    }

    const deleted = {
      ...comment,
      deletedAt: new Date().toISOString()
    };

    this.comments = this.comments.map((candidate) =>
      candidate.id === commentId ? deleted : candidate
    );

    return repositorySuccess(clone(deleted));
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
