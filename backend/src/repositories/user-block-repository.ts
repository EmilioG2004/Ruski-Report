import { BlockedUser, UserBlock, UserId } from "../domain";
import { RepositoryResult } from "./repository-result";
import { TransactionContext } from "./transaction";

export const USER_BLOCK_REPOSITORY = Symbol("USER_BLOCK_REPOSITORY");

export interface BlockUserInput {
  blockerUserId: UserId;
  blockedUser: {
    userId: UserId;
    displayName: string;
  };
  createdAt: string;
}

export type BlockUserResult =
  | {
      status: "created";
      block: UserBlock;
    }
  | {
      status: "existing";
      block: UserBlock;
    };

export interface UnblockUserResult {
  wasBlocked: boolean;
}

export interface UserBlockRepository {
  block(
    input: BlockUserInput,
    transaction: TransactionContext
  ): Promise<RepositoryResult<BlockUserResult>>;

  unblock(
    blockerUserId: UserId,
    blockedUserId: UserId,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<UnblockUserResult>>;

  listBlockedUsers(
    blockerUserId: UserId
  ): Promise<RepositoryResult<BlockedUser[]>>;
}
