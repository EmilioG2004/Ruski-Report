import { AdministratorAuthConfig } from "../security";
import {
  AdministratorMultipartCsrfVerifier,
  AdministratorMultipartOriginGuard
} from "./administrator-multipart-csrf.verifier";

describe("AdministratorMultipartCsrfVerifier", () => {
  const principal = {
    administratorId: uuid(1),
    loginName: "operator",
    displayName: "Operator",
    sessionId: uuid(2),
    authenticatedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2027-01-02T00:00:00.000Z"
  };
  const config = {
    origin: "https://admin.example.test",
    csrfCookieName: "__Host-ruski-admin-csrf"
  } as AdministratorAuthConfig;
  let security: { verifyAuthenticatedCsrf: jest.Mock };
  let audit: { recordEvent: jest.Mock };
  let verifier: AdministratorMultipartCsrfVerifier;

  beforeEach(() => {
    security = { verifyAuthenticatedCsrf: jest.fn().mockReturnValue(true) };
    audit = { recordEvent: jest.fn().mockResolvedValue(undefined) };
    verifier = new AdministratorMultipartCsrfVerifier(
      security as never,
      audit as never,
      config
    );
  });

  it("accepts an authenticated exact-origin multipart form token", async () => {
    await expect(verifier.verify({
      administratorPrincipal: principal,
      administratorCsrfTokenHash: "stored-hash",
      body: { _csrf: "raw-token" },
      headers: {
        origin: config.origin,
        cookie: `${config.csrfCookieName}=raw-token`
      }
    })).resolves.toBeUndefined();
    expect(security.verifyAuthenticatedCsrf).toHaveBeenCalledWith(
      "raw-token",
      "stored-hash"
    );
  });

  it("rejects a mismatched origin before any workbook domain action", async () => {
    await expect(verifier.verify({
      administratorPrincipal: principal,
      administratorCsrfTokenHash: "stored-hash",
      body: { _csrf: "raw-token" },
      headers: {
        origin: "https://attacker.example",
        cookie: `${config.csrfCookieName}=raw-token`
      }
    })).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(audit.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "rejected",
      reasonCode: "ADMIN_MULTIPART_CSRF_INVALID"
    }));
  });

  it("keeps the rejection when its audit write fails", async () => {
    audit.recordEvent.mockRejectedValue(new Error("database unavailable"));
    await expect(verifier.verify({
      administratorPrincipal: principal,
      body: {},
      headers: { origin: config.origin }
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a cross-origin upload in a guard before multipart buffering", async () => {
    const guard = new AdministratorMultipartOriginGuard(audit as never, config);
    const request = {
      administratorPrincipal: principal,
      headers: { origin: "https://attacker.example" }
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request })
    };

    await expect(guard.canActivate(context as never)).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: [{ code: "ADMIN_MULTIPART_ORIGIN_INVALID" }]
    });
    expect(audit.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "rejected",
      reasonCode: "ADMIN_MULTIPART_ORIGIN_INVALID"
    }));
  });
});

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}
