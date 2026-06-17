import {
  Comment,
  CommentAuthor,
  CommentId,
  MatchId
} from "../domain";
import { RepositoryResult } from "./repository-result";
import { TransactionContext } from "./transaction";

export interface CreateCommentInput {
  matchId: MatchId;
  author: CommentAuthor;
  body: string;
}

export interface CommentRepository {
  findByMatchId(matchId: MatchId): Promise<RepositoryResult<Comment[]>>;

  create(
    input: CreateCommentInput,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<Comment>>;

  delete(
    commentId: CommentId,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<Comment>>;
}
