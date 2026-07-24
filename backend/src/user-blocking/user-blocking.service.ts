import { HttpStatus, Inject, Injectable } from "@nestjs/common";

import { AuthenticatedPrincipal, BlockedUser } from "../domain";
import { AppError } from "../errors";
import { APP_LOGGER, AppLogger } from "../logging";
import {
  ACCOUNT_REPOSITORY,
  AccountRepository,
  TRANSACTION_MANAGER,
  TransactionManager,
  USER_BLOCK_REPOSITORY,
  UserBlockRepository
} from "../repositories";
import { unwrapRepositoryResult } from "../public-api/repository-result.mapper";
import { USER_BLOCK_CLOCK, UserBlockClock } from "./user-block-clock";

export interface BlockUserReceipt {
  blockedUser: BlockedUser;
  alreadyBlocked: boolean;
}

export interface UnblockUserReceipt {
  blockedUserId: string;
  wasBlocked: boolean;
}

@Injectable()
export class UserBlockingService {
  constructor(
    @Inject(ACCOUNT_REPOSITORY)
    private readonly accounts: AccountRepository,
    @Inject(USER_BLOCK_REPOSITORY)
    private readonly blocks: UserBlockRepository,
    @Inject(TRANSACTION_MANAGER)
    private readonly transactions: TransactionManager,
    @Inject(USER_BLOCK_CLOCK)
    private readonly clock: UserBlockClock,
    @Inject(APP_LOGGER)
    private readonly logger: AppLogger
  ) {}

  async list(principal: AuthenticatedPrincipal): Promise<BlockedUser[]> {
    return unwrapRepositoryResult(
      await this.blocks.listBlockedUsers(principal.userId),
      "Unable to load blocked users."
    );
  }

  async block(
    blockedUserId: string,
    principal: AuthenticatedPrincipal
  ): Promise<BlockUserReceipt> {
    if (blockedUserId === principal.userId) {
      throw selfBlockError();
    }

    const result = await this.transactions.runInTransaction(
      async (transaction) => {
        const target = unwrapRepositoryResult(
          await this.accounts.findActiveByIdForShare(
            blockedUserId,
            transaction
          ),
          "Unable to verify the account to block."
        );
        if (target === null) {
          throw blockedAccountNotFoundError(blockedUserId);
        }

        const block = unwrapRepositoryResult(
          await this.blocks.block(
            {
              blockerUserId: principal.userId,
              blockedUser: {
                userId: target.id,
                displayName: target.displayName
              },
              createdAt: this.clock.now().toISOString()
            },
            transaction
          ),
          "Unable to block the account."
        );
        return { target, block };
      }
    );

    this.logger.info("User blocking request completed.", {
      component: UserBlockingService.name,
      operation: "block",
      metadata: {
        decision: result.block.status
      }
    });
    return {
      blockedUser: {
        userId: result.target.id,
        displayName: result.target.displayName,
        blockedAt: result.block.block.createdAt
      },
      alreadyBlocked: result.block.status === "existing"
    };
  }

  async unblock(
    blockedUserId: string,
    principal: AuthenticatedPrincipal
  ): Promise<UnblockUserReceipt> {
    const result = unwrapRepositoryResult(
      await this.blocks.unblock(principal.userId, blockedUserId),
      "Unable to unblock the account."
    );
    this.logger.info("User unblocking request completed.", {
      component: UserBlockingService.name,
      operation: "unblock",
      metadata: {
        wasBlocked: result.wasBlocked
      }
    });
    return {
      blockedUserId,
      wasBlocked: result.wasBlocked
    };
  }
}

function selfBlockError(): AppError {
  return new AppError({
    code: "BAD_REQUEST",
    message: "You cannot block your own account.",
    statusCode: HttpStatus.BAD_REQUEST,
    details: [
      {
        code: "SELF_BLOCK_NOT_ALLOWED",
        message: "Choose a different account.",
        path: "userId"
      }
    ]
  });
}

function blockedAccountNotFoundError(userId: string): AppError {
  return new AppError({
    code: "NOT_FOUND",
    message: "The account is no longer available.",
    statusCode: HttpStatus.NOT_FOUND,
    details: [
      {
        code: "BLOCKED_ACCOUNT_NOT_FOUND",
        message: "Refresh the comments and try again.",
        path: "userId",
        metadata: { userId }
      }
    ]
  });
}
