import { AuthenticatedPrincipal, BlockedUser } from "../domain";
import { UserBlockingController } from "./user-blocking.controller";
import {
  BlockUserReceipt,
  UnblockUserReceipt,
  UserBlockingService
} from "./user-blocking.service";

const principal: AuthenticatedPrincipal = {
  userId: "viewer-1",
  displayName: "Viewer",
  provider: "local_account",
  sessionId: "session-1",
  expiresAt: "2026-08-01T00:00:00.000Z"
};

const blockedUser: BlockedUser = {
  userId: "target-1",
  displayName: "Target",
  blockedAt: "2026-07-23T12:00:00.000Z"
};

describe("UserBlockingController", () => {
  it("delegates list, block, and unblock using the verified principal", async () => {
    const blockReceipt: BlockUserReceipt = {
      blockedUser,
      alreadyBlocked: false
    };
    const unblockReceipt: UnblockUserReceipt = {
      blockedUserId: blockedUser.userId,
      wasBlocked: true
    };
    const service = {
      list: jest.fn().mockResolvedValue([blockedUser]),
      block: jest.fn().mockResolvedValue(blockReceipt),
      unblock: jest.fn().mockResolvedValue(unblockReceipt)
    } as unknown as UserBlockingService;
    const controller = new UserBlockingController(service);

    await expect(controller.list(principal)).resolves.toEqual([blockedUser]);
    await expect(
      controller.block(blockedUser.userId, principal)
    ).resolves.toBe(blockReceipt);
    await expect(
      controller.unblock(blockedUser.userId, principal)
    ).resolves.toBe(unblockReceipt);

    expect(service.list).toHaveBeenCalledWith(principal);
    expect(service.block).toHaveBeenCalledWith(
      blockedUser.userId,
      principal
    );
    expect(service.unblock).toHaveBeenCalledWith(
      blockedUser.userId,
      principal
    );
  });
});
