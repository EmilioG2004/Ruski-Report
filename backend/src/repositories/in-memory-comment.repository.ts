import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { Comment, CommentId, MatchId } from "../domain";
import {
  CommentRepository,
  CreateCommentInput
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

  async findByMatchId(
    matchId: MatchId
  ): Promise<RepositoryResult<Comment[]>> {
    return repositorySuccess(
      clone(
        this.comments.filter(
          (comment) =>
            comment.matchId === matchId && comment.deletedAt === undefined
        )
      )
    );
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
    return repositorySuccess(clone(comment));
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
