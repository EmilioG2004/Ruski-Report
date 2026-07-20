import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import {
  Comment,
  CommentAuthorKind,
  Metadata
} from "../../domain";
import { PostgresDatabase } from "../../database";
import {
  CommentRepository,
  CreateCommentInput
} from "../comment-repository";
import {
  repositoryFailure,
  repositorySuccess,
  RepositoryResult
} from "../repository-result";
import { TransactionContext } from "../transaction";
import { selectPostgresExecutor } from "./postgres-executor";
import { mapPostgresError } from "./postgres-repository-error";
import { readISOString, readOptionalJson } from "./postgres-values";

interface CommentRow {
  id: string;
  match_id: string;
  author_kind: CommentAuthorKind;
  author_display_name: string;
  author_user_id: string | null;
  body: string;
  created_at: Date | string;
  updated_at: Date | string | null;
  deleted_at: Date | string | null;
  metadata: unknown;
}

@Injectable()
export class PostgresCommentRepository implements CommentRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async findByMatchId(
    matchId: string
  ): Promise<RepositoryResult<Comment[]>> {
    try {
      const result = await this.database.query<CommentRow>(
        `
          SELECT * FROM comments
          WHERE match_id = $1 AND deleted_at IS NULL
          ORDER BY created_at, id
        `,
        [matchId]
      );
      return repositorySuccess(result.rows.map(mapComment));
    } catch (error) {
      return this.failure(error, "Failed to read match comments.");
    }
  }

  async create(
    input: CreateCommentInput,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<Comment>> {
    try {
      const executor = selectPostgresExecutor(this.database, transaction);
      const id = `comment-${randomUUID()}`;
      const createdAt = new Date().toISOString();
      const result = await executor.query<CommentRow>(
        `
          INSERT INTO comments (
            id, match_id, author_kind, author_display_name,
            author_user_id, body, created_at, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `,
        [
          id,
          input.matchId,
          input.author.kind,
          input.author.displayName,
          input.author.userId ?? null,
          input.body,
          createdAt,
          {}
        ]
      );
      return repositorySuccess(mapComment(result.rows[0]));
    } catch (error) {
      return this.failure(error, "Failed to create comment.");
    }
  }

  async delete(
    commentId: string,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<Comment>> {
    try {
      const executor = selectPostgresExecutor(this.database, transaction);
      const result = await executor.query<CommentRow>(
        `
          UPDATE comments
          SET deleted_at = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *
        `,
        [commentId]
      );
      const row = result.rows[0];

      return row === undefined
        ? repositoryFailure({
            code: "not_found",
            message: `Comment "${commentId}" was not found.`
          })
        : repositorySuccess(mapComment(row));
    } catch (error) {
      return this.failure(error, "Failed to delete comment.");
    }
  }

  private failure<T>(error: unknown, message: string): RepositoryResult<T> {
    return repositoryFailure(mapPostgresError(error, message));
  }
}

function mapComment(row: CommentRow): Comment {
  return {
    id: row.id,
    matchId: row.match_id,
    author: {
      kind: row.author_kind,
      displayName: row.author_display_name,
      userId: row.author_user_id ?? undefined
    },
    body: row.body,
    createdAt: readISOString(row.created_at),
    updatedAt:
      row.updated_at === null ? undefined : readISOString(row.updated_at),
    deletedAt:
      row.deleted_at === null ? undefined : readISOString(row.deleted_at),
    metadata: readOptionalJson<Metadata>(row.metadata)
  };
}
