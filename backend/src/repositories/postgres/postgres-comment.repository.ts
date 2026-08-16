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
  CreateCommentInput,
  CreateCommentResult
} from "../comment-repository";
import {
  repositoryFailure,
  repositorySuccess,
  RepositoryResult
} from "../repository-result";
import { TransactionContext } from "../transaction";
import { selectPostgresExecutor } from "./postgres-executor";
import { mapPostgresError } from "./postgres-repository-error";
import { readISOString, readOptionalJson, writeJson } from "./postgres-values";

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
    matchId: string,
    viewerUserId?: string
  ): Promise<RepositoryResult<Comment[]>> {
    try {
      const result = await this.database.query<CommentRow>(
        `
          SELECT * FROM comments
          WHERE match_id = $1 AND deleted_at IS NULL
            AND (
              $2::text IS NULL
              OR author_user_id IS NULL
              OR NOT EXISTS (
                SELECT 1
                FROM user_blocks block
                WHERE block.blocker_user_id = $2
                  AND block.blocked_user_id = comments.author_user_id
              )
            )
          ORDER BY created_at, id
        `,
        [matchId, viewerUserId ?? null]
      );
      return repositorySuccess(result.rows.map(mapComment));
    } catch (error) {
      return this.failure(error, "Failed to read match comments.");
    }
  }

  async findById(
    commentId: string,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<Comment | null>> {
    return this.findLiveComment(commentId, transaction, false);
  }

  async findByIdForUpdate(
    commentId: string,
    transaction: TransactionContext
  ): Promise<RepositoryResult<Comment | null>> {
    return this.findLiveComment(commentId, transaction, true);
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
            author_user_id, body, created_at, metadata,
            normalized_body_hash
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
          writeJson({}),
          input.normalizedBodyHash ?? null
        ]
      );
      return repositorySuccess(mapComment(result.rows[0]));
    } catch (error) {
      return this.failure(error, "Failed to create comment.");
    }
  }

  async createUnlessRecentDuplicate(
    input: CreateCommentInput,
    earliestDuplicateCreatedAt: string,
    transaction: TransactionContext
  ): Promise<RepositoryResult<CreateCommentResult>> {
    const userId = input.author.userId;
    const normalizedBodyHash = input.normalizedBodyHash;
    if (userId === undefined || normalizedBodyHash === undefined) {
      return repositoryFailure({
        code: "validation_failed",
        message:
          "Moderated comment creation requires an account identifier and normalized body hash."
      });
    }

    try {
      const executor = selectPostgresExecutor(this.database, transaction);
      await executor.query(
        `
          SELECT pg_advisory_xact_lock(
            hashtextextended($1::text || ':' || $2::text, 0)
          )
        `,
        [input.matchId, userId]
      );
      const duplicate = await executor.query<{ exists: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM comments
            WHERE match_id = $1
              AND author_user_id = $2
              AND normalized_body_hash = $3
              AND created_at >= $4::timestamptz
              AND deleted_at IS NULL
          )
        `,
        [
          input.matchId,
          userId,
          normalizedBodyHash,
          earliestDuplicateCreatedAt
        ]
      );

      if (duplicate.rows[0]?.exists === true) {
        return repositorySuccess({ status: "duplicate" });
      }

      const created = await this.create(input, transaction);
      return created.ok
        ? repositorySuccess({
            status: "created",
            comment: created.value
          })
        : created;
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

  private async findLiveComment(
    commentId: string,
    transaction: TransactionContext | undefined,
    forUpdate: boolean
  ): Promise<RepositoryResult<Comment | null>> {
    try {
      const executor = selectPostgresExecutor(this.database, transaction);
      const result = await executor.query<CommentRow>(
        `
          SELECT *
          FROM comments
          WHERE id = $1 AND deleted_at IS NULL
          ${forUpdate ? "FOR UPDATE" : ""}
        `,
        [commentId]
      );
      const row = result.rows[0];
      return repositorySuccess(row === undefined ? null : mapComment(row));
    } catch (error) {
      return this.failure(error, "Failed to read comment.");
    }
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
