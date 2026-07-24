import { Injectable } from "@nestjs/common";

import { PostgresDatabase } from "../../database";
import { BlockedUser, UserBlock } from "../../domain";
import {
  BlockUserInput,
  BlockUserResult,
  UnblockUserResult,
  UserBlockRepository
} from "../user-block-repository";
import {
  repositoryFailure,
  repositorySuccess,
  RepositoryResult
} from "../repository-result";
import { TransactionContext } from "../transaction";
import { selectPostgresExecutor } from "./postgres-executor";
import { mapPostgresError } from "./postgres-repository-error";
import { readISOString } from "./postgres-values";

interface UserBlockRow {
  blocker_user_id: string;
  blocked_user_id: string;
  created_at: Date | string;
}

interface BlockedUserRow {
  user_id: string;
  display_name: string;
  blocked_at: Date | string;
}

@Injectable()
export class PostgresUserBlockRepository implements UserBlockRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async block(
    input: BlockUserInput,
    transaction: TransactionContext
  ): Promise<RepositoryResult<BlockUserResult>> {
    try {
      const executor = selectPostgresExecutor(this.database, transaction);
      const inserted = await executor.query<UserBlockRow>(
        `
          INSERT INTO user_blocks (
            blocker_user_id,
            blocked_user_id,
            created_at
          ) VALUES ($1, $2, $3)
          ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING
          RETURNING *
        `,
        [
          input.blockerUserId,
          input.blockedUser.userId,
          input.createdAt
        ]
      );
      if (inserted.rows[0] !== undefined) {
        return repositorySuccess({
          status: "created",
          block: mapUserBlock(inserted.rows[0])
        });
      }

      const existing = await executor.query<UserBlockRow>(
        `
          SELECT *
          FROM user_blocks
          WHERE blocker_user_id = $1 AND blocked_user_id = $2
        `,
        [input.blockerUserId, input.blockedUser.userId]
      );
      return repositorySuccess({
        status: "existing",
        block: mapUserBlock(existing.rows[0])
      });
    } catch (error) {
      return repositoryFailure(
        mapPostgresError(error, "Failed to block account.")
      );
    }
  }

  async unblock(
    blockerUserId: string,
    blockedUserId: string,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<UnblockUserResult>> {
    try {
      const executor = selectPostgresExecutor(this.database, transaction);
      const result = await executor.query<{ blocked_user_id: string }>(
        `
          DELETE FROM user_blocks
          WHERE blocker_user_id = $1 AND blocked_user_id = $2
          RETURNING blocked_user_id
        `,
        [blockerUserId, blockedUserId]
      );
      return repositorySuccess({
        wasBlocked: result.rows[0] !== undefined
      });
    } catch (error) {
      return repositoryFailure(
        mapPostgresError(error, "Failed to unblock account.")
      );
    }
  }

  async listBlockedUsers(
    blockerUserId: string
  ): Promise<RepositoryResult<BlockedUser[]>> {
    try {
      const result = await this.database.query<BlockedUserRow>(
        `
          SELECT
            account.id AS user_id,
            account.display_name,
            block.created_at AS blocked_at
          FROM user_blocks block
          JOIN user_accounts account ON account.id = block.blocked_user_id
          WHERE block.blocker_user_id = $1
          ORDER BY block.created_at DESC, block.blocked_user_id
        `,
        [blockerUserId]
      );
      return repositorySuccess(result.rows.map(mapBlockedUser));
    } catch (error) {
      return repositoryFailure(
        mapPostgresError(error, "Failed to list blocked accounts.")
      );
    }
  }
}

function mapUserBlock(row: UserBlockRow): UserBlock {
  return {
    blockerUserId: row.blocker_user_id,
    blockedUserId: row.blocked_user_id,
    createdAt: readISOString(row.created_at)
  };
}

function mapBlockedUser(row: BlockedUserRow): BlockedUser {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    blockedAt: readISOString(row.blocked_at)
  };
}
