import { ExecutionContext } from "@nestjs/common";

import { AppError } from "../errors";
import { AdminAuthGuard } from "./admin-auth.guard";

const originalToken = process.env.ADMIN_UPLOAD_TOKEN;

describe("AdminAuthGuard", () => {
  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.ADMIN_UPLOAD_TOKEN;
      return;
    }

    process.env.ADMIN_UPLOAD_TOKEN = originalToken;
  });

  it("allows requests with the configured admin token", () => {
    process.env.ADMIN_UPLOAD_TOKEN = "secret-token";
    const guard = new AdminAuthGuard();

    expect(
      guard.canActivate(createContext({ "x-admin-token": "secret-token" }))
    ).toBe(true);
  });

  it("rejects requests with a missing or invalid token", () => {
    process.env.ADMIN_UPLOAD_TOKEN = "secret-token";
    const guard = new AdminAuthGuard();

    expect(() => guard.canActivate(createContext({}))).toThrow(AppError);

    try {
      guard.canActivate(createContext({ "x-admin-token": "wrong-token" }));
      fail("Expected invalid token to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("UNAUTHORIZED");
      expect((error as AppError).statusCode).toBe(401);
    }
  });

  it("rejects requests when the server token is not configured", () => {
    delete process.env.ADMIN_UPLOAD_TOKEN;
    const guard = new AdminAuthGuard();

    try {
      guard.canActivate(createContext({ "x-admin-token": "secret-token" }));
      fail("Expected missing server token to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("FORBIDDEN");
      expect((error as AppError).statusCode).toBe(403);
    }
  });
});

function createContext(
  headers: Record<string, string | string[] | undefined>
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers
      })
    })
  } as unknown as ExecutionContext;
}
