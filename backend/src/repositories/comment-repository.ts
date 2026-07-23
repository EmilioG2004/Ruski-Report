import {
  Comment,
  CommentAuthor,
  CommentId,
  MatchId
} from "../domain";
import { RepositoryResult } from "./repository-result";
import { TransactionContext } from "./transaction";

export const COMMENT_REPOSITORY = Symbol("COMMENT_REPOSITORY");

export interface CreateCommentInput {
  matchId: MatchId;
  author: CommentAuthor;
  body: string;
  normalizedBodyHash?: string;
}

export type CreateCommentResult =
  | {
      status: "created";
      comment: Comment;
    }
  | {
      status: "duplicate";
    };

export interface CommentRepository {
  findByMatchId(matchId: MatchId): Promise<RepositoryResult<Comment[]>>;

  create(
    input: CreateCommentInput,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<Comment>>;

  createUnlessRecentDuplicate(
    input: CreateCommentInput,
    earliestDuplicateCreatedAt: string,
    transaction: TransactionContext
  ): Promise<RepositoryResult<CreateCommentResult>>;

  delete(
    commentId: CommentId,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<Comment>>;
}
