import { ExecutionContext } from "@nestjs/common";

import { AppError } from "../errors";
import { AdminAuthGuard } from "./admin-auth.guard";

describe("AdminAuthGuard", () => {
  it("allows requests with the configured admin token", () => {
    const guard = createGuard("secret-token");
    const request = createRequest({ "x-admin-token": "secret-token" });

    expect(guard.canActivate(createContext(request))).toBe(true);
    expect(request.adminPrincipal).toEqual({
      operatorId: "operator-1"
    });
  });

  it("rejects requests with a missing or invalid token", () => {
    const guard = createGuard("secret-token");

    expect(() =>
      guard.canActivate(createContext(createRequest({})))
    ).toThrow(AppError);

    try {
      guard.canActivate(
        createContext(createRequest({ "x-admin-token": "wrong-token" }))
      );
      fail("Expected invalid token to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("UNAUTHORIZED");
      expect((error as AppError).statusCode).toBe(401);
    }
  });

  it("rejects requests when the server token is not configured", () => {
    const guard = createGuard(undefined);

    try {
      guard.canActivate(
        createContext(createRequest({ "x-admin-token": "secret-token" }))
      );
      fail("Expected missing server token to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("FORBIDDEN");
      expect((error as AppError).statusCode).toBe(403);
    }
  });
});

function createGuard(apiToken: string | undefined): AdminAuthGuard {
  return new AdminAuthGuard({
    apiToken,
    operatorId: "operator-1"
  });
}

function createRequest(
  headers: Record<string, string | string[] | undefined>
): {
  headers: Record<string, string | string[] | undefined>;
  adminPrincipal?: { operatorId: string };
} {
  return { headers };
}

function createContext(
  request: ReturnType<typeof createRequest>
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request
    })
  } as unknown as ExecutionContext;
}
