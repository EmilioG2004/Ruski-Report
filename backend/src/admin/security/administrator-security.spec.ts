import { ExecutionContext } from "@nestjs/common";

import { loadAdministratorAuthConfig } from "../../config/admin-auth.config";
import { AdministratorPasswordHasher } from "./administrator-password.hasher";
import {
  AdministratorCookieResponse,
  setAdministratorSessionCookies,
  setPreAuthCsrfCookie
} from "./administrator-cookies";
import { AdministratorCsrfGuard } from "./administrator-csrf.guard";
import { AdministratorSecurityAuditService } from "./administrator-security-audit.service";
import { AdministratorSecurityService } from "./administrator-security.service";
import { AdministratorSecurityTokens } from "./administrator-security.tokens";
import { AdministratorSessionGuard } from "./administrator-session.guard";

const config = loadAdministratorAuthConfig({
  ADMIN_AUTH_SCRYPT_COST: "1024",
  ADMIN_AUTH_SCRYPT_KEY_LENGTH: "32"
});

describe("administrator security primitives", () => {
  it("creates versioned password hashes and detects changed work factors", async () => {
    const hasher = new AdministratorPasswordHasher(config);
    const encoded = await hasher.hash("correct horse battery");

    expect(encoded).toMatch(/^scrypt\$1\$1024\$/);
    await expect(hasher.verify("correct horse battery", encoded)).resolves.toBe(true);
    await expect(hasher.verify("wrong password", encoded)).resolves.toBe(false);
    expect(hasher.needsRehash(encoded)).toBe(false);
    expect(hasher.needsRehash("invalid")).toBe(true);
  });

  it("hashes opaque tokens and authenticates expiring pre-auth CSRF values", () => {
    const tokens = new AdministratorSecurityTokens(config);
    const opaque = tokens.issueOpaqueToken();
    const now = new Date("2026-08-20T12:00:00.000Z");
    const csrf = tokens.issuePreAuthCsrf(now);

    expect(opaque.raw).not.toBe(opaque.hash);
    expect(opaque.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokens.verifyPreAuthCsrf(
      csrf.token,
      new Date("2026-08-20T12:14:59.000Z")
    )).toBe(true);
    expect(tokens.verifyPreAuthCsrf(
      csrf.token,
      new Date("2026-08-20T12:15:00.000Z")
    )).toBe(false);
    expect(tokens.verifyPreAuthCsrf(`${csrf.token}x`, now)).toBe(false);
  });

  it("uses strict HttpOnly session cookies without exposing CSRF to HTTP only", () => {
    const response = { append: jest.fn() } as AdministratorCookieResponse;
    const productionConfig = loadAdministratorAuthConfig({
      NODE_ENV: "production",
      ADMIN_WEB_ORIGIN: "https://admin.example.com",
      ADMIN_AUTH_SECURITY_SECRET: "x".repeat(32)
    });

    setAdministratorSessionCookies(
      response,
      productionConfig,
      "session-token",
      "csrf-token",
      "2099-01-01T00:00:00.000Z"
    );

    const sessionCookie = (response.append as jest.Mock).mock.calls[0][1];
    const csrfCookie = (response.append as jest.Mock).mock.calls[1][1];
    expect(sessionCookie).toContain("__Host-ruski_admin_session=session-token");
    expect(sessionCookie).toContain("Secure");
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("SameSite=Strict");
    expect(sessionCookie).not.toContain("Domain=");
    expect(csrfCookie).toContain("__Host-ruski_admin_csrf=csrf-token");
    expect(csrfCookie).not.toContain("HttpOnly");
    expect((response.append as jest.Mock).mock.calls[2][1]).toContain(
      "__Host-ruski_admin_preauth_csrf=deleted"
    );
  });

  it("keeps pre-auth CSRF separate from an authenticated session CSRF cookie", () => {
    const response = { append: jest.fn() } as AdministratorCookieResponse;
    setAdministratorSessionCookies(
      response,
      config,
      "session-token",
      "authenticated-csrf",
      "2099-01-01T00:00:00.000Z"
    );
    setPreAuthCsrfCookie(
      response,
      config,
      "preauth-csrf",
      "2099-01-01T00:00:00.000Z"
    );

    const setCookies = (response.append as jest.Mock).mock.calls
      .map((call) => call[1] as string);
    expect(setCookies).toEqual(expect.arrayContaining([
      expect.stringContaining(`${config.csrfCookieName}=authenticated-csrf`),
      expect.stringContaining(`${config.preAuthCsrfCookieName}=preauth-csrf`)
    ]));
  });
});

describe("AdministratorCsrfGuard", () => {
  it("accepts exact-origin pre-auth double-submit CSRF", async () => {
    const tokens = new AdministratorSecurityTokens(config);
    const csrf = tokens.issuePreAuthCsrf();
    const security = {
      verifyPreAuthCsrf: jest.fn().mockReturnValue(true)
    } as unknown as AdministratorSecurityService;
    const audit = {
      recordEvent: jest.fn()
    } as unknown as AdministratorSecurityAuditService;
    const guard = new AdministratorCsrfGuard(security, tokens, audit, config);
    const request = {
      headers: {
        origin: config.origin,
        cookie: `${config.preAuthCsrfCookieName}=${csrf.token}`,
        "x-csrf-token": csrf.token
      }
    };

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(security.verifyPreAuthCsrf).toHaveBeenCalledWith(csrf.token);
  });

  it("uses only the authenticated CSRF cookie when a session is present", async () => {
    const tokens = new AdministratorSecurityTokens(config);
    const rawCsrf = "authenticated-csrf-token";
    const security = {
      verifyAuthenticatedCsrf: jest.fn().mockReturnValue(true)
    } as unknown as AdministratorSecurityService;
    const audit = { recordEvent: jest.fn() } as unknown as
      AdministratorSecurityAuditService;
    const guard = new AdministratorCsrfGuard(security, tokens, audit, config);
    const request = {
      administratorPrincipal: {
        administratorId: "00000000-0000-4000-8000-000000000001",
        sessionId: "00000000-0000-4000-8000-000000000002"
      },
      administratorCsrfTokenHash: tokens.hashOpaqueToken(rawCsrf),
      headers: {
        origin: config.origin,
        cookie: `${config.preAuthCsrfCookieName}=different-preauth; ` +
          `${config.csrfCookieName}=${rawCsrf}`,
        "x-csrf-token": rawCsrf
      }
    };

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(security.verifyAuthenticatedCsrf).toHaveBeenCalledWith(
      rawCsrf,
      request.administratorCsrfTokenHash
    );
  });

  it("rejects cross-origin and mismatched requests without recording tokens", async () => {
    const tokens = new AdministratorSecurityTokens(config);
    const audit = {
      recordEvent: jest.fn().mockResolvedValue(undefined)
    } as unknown as AdministratorSecurityAuditService;
    const guard = new AdministratorCsrfGuard(
      {} as AdministratorSecurityService,
      tokens,
      audit,
      config
    );

    await expect(guard.canActivate(context({
      headers: {
        origin: "https://attacker.example",
        cookie: `${config.preAuthCsrfCookieName}=cookie-token`,
        "x-csrf-token": "header-token"
      }
    }))).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(audit.recordEvent).toHaveBeenCalledWith(expect.not.objectContaining({
      details: expect.anything()
    }));
  });
});

describe("AdministratorSessionGuard", () => {
  it("rejects a legacy header and authenticates only the administrator cookie", async () => {
    const principal = {
      administratorId: "00000000-0000-4000-8000-000000000001",
      loginName: "operator",
      displayName: "Operator",
      sessionId: "00000000-0000-4000-8000-000000000002",
      authenticatedAt: "2026-08-20T12:00:00.000Z",
      expiresAt: "2026-08-20T13:00:00.000Z"
    };
    const security = {
      authenticateSession: jest.fn().mockResolvedValue({
        principal,
        csrfTokenHash: "a".repeat(64)
      })
    } as unknown as AdministratorSecurityService;
    const audit = {
      recordEvent: jest.fn().mockResolvedValue(undefined)
    } as unknown as AdministratorSecurityAuditService;
    const guard = new AdministratorSessionGuard(security, audit, config);

    await expect(guard.canActivate(context({
      headers: { "x-admin-token": "legacy-shared-token" }
    }))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(security.authenticateSession).not.toHaveBeenCalled();

    const request: Record<string, unknown> = {
      headers: { cookie: `${config.sessionCookieName}=opaque_session` }
    };
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(security.authenticateSession).toHaveBeenCalledWith("opaque_session");
    expect(request.administratorPrincipal).toBe(principal);
    expect(request.administratorCsrfTokenHash).toBe("a".repeat(64));
  });
});

function context(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
}
