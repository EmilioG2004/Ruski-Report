import { AuthenticatedPrincipal, UserAccount } from "../domain";
import { AppError } from "../errors";
import { AppLogger } from "../logging";
import {
  AccountRepository,
  InMemoryTransactionManager,
  InMemoryUserBlockRepository,
  repositorySuccess
} from "../repositories";
import { UserBlockClock } from "./user-block-clock";
import { UserBlockingService } from "./user-blocking.service";

const principal: AuthenticatedPrincipal = {
  userId: "user-viewer",
  displayName: "Viewer",
  provider: "local_account",
  sessionId: "session-1",
  expiresAt: "2026-08-01T00:00:00.000Z"
};

const target: UserAccount = {
  id: "user-target",
  displayName: "Target Player",
  normalizedDisplayName: "target player",
  provider: "local_account",
  status: "active",
  createdAt: "2026-07-01T12:00:00.000Z",
  updatedAt: "2026-07-01T12:00:00.000Z"
};

describe("UserBlockingService", () => {
  it("creates one private block and returns the original relation on retry", async () => {
    const dependencies = createDependencies(target);

    const created = await dependencies.service.block(target.id, principal);
    const retried = await dependencies.service.block(target.id, principal);
    const blockedUsers = await dependencies.service.list(principal);

    expect(created).toEqual({
      blockedUser: {
        userId: target.id,
        displayName: target.displayName,
        blockedAt: "2026-07-23T12:00:00.000Z"
      },
      alreadyBlocked: false
    });
    expect(retried).toEqual({
      ...created,
      alreadyBlocked: true
    });
    expect(blockedUsers).toEqual([created.blockedUser]);
    expect(JSON.stringify(dependencies.logger.info.mock.calls)).not.toContain(
      principal.userId
    );
    expect(JSON.stringify(dependencies.logger.info.mock.calls)).not.toContain(
      target.displayName
    );
  });

  it("unblocks idempotently", async () => {
    const dependencies = createDependencies(target);
    await dependencies.service.block(target.id, principal);

    await expect(
      dependencies.service.unblock(target.id, principal)
    ).resolves.toEqual({
      blockedUserId: target.id,
      wasBlocked: true
    });
    await expect(
      dependencies.service.unblock(target.id, principal)
    ).resolves.toEqual({
      blockedUserId: target.id,
      wasBlocked: false
    });
  });

  it("rejects self-blocking before reading persistence", async () => {
    const dependencies = createDependencies(target);

    await expect(
      dependencies.service.block(principal.userId, principal)
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      details: [
        expect.objectContaining({ code: "SELF_BLOCK_NOT_ALLOWED" })
      ]
    } satisfies Partial<AppError>);
    expect(
      dependencies.accounts.findActiveByIdForShare
    ).not.toHaveBeenCalled();
  });

  it("returns a stable error when the target account is unavailable", async () => {
    const dependencies = createDependencies(null);

    await expect(
      dependencies.service.block("missing-user", principal)
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      details: [
        expect.objectContaining({ code: "BLOCKED_ACCOUNT_NOT_FOUND" })
      ]
    } satisfies Partial<AppError>);
  });
});

function createDependencies(account: UserAccount | null) {
  const accounts = {
    findActiveByIdForShare: jest
      .fn()
      .mockResolvedValue(repositorySuccess(account))
  } as unknown as jest.Mocked<AccountRepository>;
  const logger: jest.Mocked<AppLogger> = {
    debug: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn()
  };
  const clock: UserBlockClock = {
    now: () => new Date("2026-07-23T12:00:00.000Z")
  };
  const service = new UserBlockingService(
    accounts,
    new InMemoryUserBlockRepository(),
    new InMemoryTransactionManager(),
    clock,
    logger
  );
  return { accounts, logger, service };
}
