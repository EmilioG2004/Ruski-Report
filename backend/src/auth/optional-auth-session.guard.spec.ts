import { ExecutionContext } from "@nestjs/common";

import { AuthConfig } from "../config/auth.config";
import { AuthenticatedPrincipal } from "../domain";
import { AuthService } from "./auth.service";
import { AuthenticatedRequest } from "./authenticated-request";
import { OptionalAuthSessionGuard } from "./optional-auth-session.guard";
import { SessionTokenService } from "./session-token.service";

const config: AuthConfig = {
  maximumDisplayNameLength: 40,
  minimumPasswordLength: 10,
  maximumPasswordLength: 128,
  sessionLifetimeSeconds: 3600,
  passwordHash: {
    cost: 1024,
    blockSize: 8,
    parallelization: 1,
    keyLength: 32,
    saltLength: 16
  },
  sessionTokenLength: 32
};

const principal: AuthenticatedPrincipal = {
  userId: "user-1",
  displayName: "Alex",
  provider: "local_account",
  sessionId: "session-1",
  expiresAt: "2026-07-30T12:00:00.000Z"
};

describe("OptionalAuthSessionGuard", () => {
  it("allows a request with no authorization header as a guest", async () => {
    const auth = { authenticate: jest.fn() } as unknown as AuthService;
    const guard = new OptionalAuthSessionGuard(
      auth,
      new SessionTokenService(config)
    );
    const { context, request } = createContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auth.authenticate).not.toHaveBeenCalled();
    expect(request.principal).toBeUndefined();
  });

  it("authenticates a supplied bearer token and attaches its identity", async () => {
    const auth = {
      authenticate: jest.fn().mockResolvedValue(principal)
    } as unknown as AuthService;
    const tokens = new SessionTokenService(config);
    const guard = new OptionalAuthSessionGuard(auth, tokens);
    const { context, request } = createContext("Bearer opaque_token");

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auth.authenticate).toHaveBeenCalledWith("opaque_token");
    expect(request.principal).toBe(principal);
    expect(request.sessionTokenHash).toBe(tokens.hash("opaque_token"));
  });

  it("rejects malformed supplied credentials instead of downgrading to guest", async () => {
    const auth = { authenticate: jest.fn() } as unknown as AuthService;
    const guard = new OptionalAuthSessionGuard(
      auth,
      new SessionTokenService(config)
    );

    await expect(
      guard.canActivate(createContext("Basic credentials").context)
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      statusCode: 401
    });
    expect(auth.authenticate).not.toHaveBeenCalled();
  });
});

function createContext(authorization?: string): {
  context: ExecutionContext;
  request: AuthenticatedRequest;
} {
  const request: AuthenticatedRequest = {
    headers: authorization === undefined ? {} : { authorization }
  };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request })
    } as unknown as ExecutionContext
  };
}
