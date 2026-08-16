import { BlockedUser, UserBlock } from "../domain";
import {
  BlockUserInput,
  BlockUserResult,
  UnblockUserResult,
  UserBlockRepository
} from "./user-block-repository";
import {
  repositorySuccess,
  RepositoryResult
} from "./repository-result";
import { TransactionContext } from "./transaction";

export class InMemoryUserBlockRepository implements UserBlockRepository {
  private blocks: UserBlock[] = [];
  private readonly displayNames = new Map<string, string>();

  async block(
    input: BlockUserInput,
    _transaction: TransactionContext
  ): Promise<RepositoryResult<BlockUserResult>> {
    const existing = this.blocks.find(
      (block) =>
        block.blockerUserId === input.blockerUserId &&
        block.blockedUserId === input.blockedUser.userId
    );
    if (existing !== undefined) {
      return repositorySuccess({
        status: "existing",
        block: clone(existing)
      });
    }

    const block: UserBlock = {
      blockerUserId: input.blockerUserId,
      blockedUserId: input.blockedUser.userId,
      createdAt: input.createdAt
    };
    this.blocks = [...this.blocks, block];
    this.displayNames.set(
      input.blockedUser.userId,
      input.blockedUser.displayName
    );
    return repositorySuccess({ status: "created", block: clone(block) });
  }

  async unblock(
    blockerUserId: string,
    blockedUserId: string,
    _transaction?: TransactionContext
  ): Promise<RepositoryResult<UnblockUserResult>> {
    const remaining = this.blocks.filter(
      (block) =>
        block.blockerUserId !== blockerUserId ||
        block.blockedUserId !== blockedUserId
    );
    const wasBlocked = remaining.length !== this.blocks.length;
    this.blocks = remaining;
    return repositorySuccess({ wasBlocked });
  }

  async listBlockedUsers(
    blockerUserId: string
  ): Promise<RepositoryResult<BlockedUser[]>> {
    const users = this.blocks
      .filter((block) => block.blockerUserId === blockerUserId)
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          left.blockedUserId.localeCompare(right.blockedUserId)
      )
      .map((block) => ({
        userId: block.blockedUserId,
        displayName:
          this.displayNames.get(block.blockedUserId) ?? block.blockedUserId,
        blockedAt: block.createdAt
      }));
    return repositorySuccess(clone(users));
  }

  isBlocked(blockerUserId: string, blockedUserId: string): boolean {
    return this.blocks.some(
      (block) =>
        block.blockerUserId === blockerUserId &&
        block.blockedUserId === blockedUserId
    );
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
