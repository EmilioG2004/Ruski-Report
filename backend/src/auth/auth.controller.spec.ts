import { AuthenticatedPrincipal } from "../domain";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

const principal: AuthenticatedPrincipal = {
  userId: "user-1",
  displayName: "Alex",
  provider: "local_account",
  sessionId: "session-1",
  expiresAt: "2026-07-30T12:00:00.000Z"
};

describe("AuthController", () => {
  it("deletes only the account selected by the authenticated principal", async () => {
    const auth = {
      deleteAccount: jest.fn().mockResolvedValue(undefined)
    } as unknown as AuthService;
    const controller = new AuthController(auth);

    await controller.deleteAccount(principal);

    expect(auth.deleteAccount).toHaveBeenCalledWith("user-1");
  });
});
