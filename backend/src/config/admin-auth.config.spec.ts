import { loadAdministratorAuthConfig } from "./admin-auth.config";

describe("administrator auth config", () => {
  it("uses same-origin development defaults with safe production-grade work factors", () => {
    const config = loadAdministratorAuthConfig({});

    expect(config).toMatchObject({
      origin: "http://localhost:3000",
      production: false,
      secureCookies: false,
      sessionCookieName: "ruski_admin_session",
      csrfCookieName: "ruski_admin_csrf",
      preAuthCsrfCookieName: "ruski_admin_preauth_csrf",
      minimumPasswordLength: 12,
      sessionLifetimeSeconds: 43_200,
      sessionIdleLifetimeSeconds: 7_200,
      passwordHash: { cost: 16_384 }
    });
  });

  it("uses __Host cookies for a configured production origin", () => {
    const config = loadAdministratorAuthConfig({
      NODE_ENV: "production",
      ADMIN_WEB_ORIGIN: "https://admin.ruskireport.com",
      ADMIN_AUTH_SECURITY_SECRET: "x".repeat(32)
    });

    expect(config).toMatchObject({
      secureCookies: true,
      sessionCookieName: "__Host-ruski_admin_session",
      csrfCookieName: "__Host-ruski_admin_csrf",
      preAuthCsrfCookieName: "__Host-ruski_admin_preauth_csrf"
    });
  });

  it("rejects unsafe production and inconsistent settings", () => {
    expect(() => loadAdministratorAuthConfig({
      NODE_ENV: "production",
      ADMIN_WEB_ORIGIN: "http://admin.example.com",
      ADMIN_AUTH_SECURITY_SECRET: "x".repeat(32)
    })).toThrow("HTTPS");
    expect(() => loadAdministratorAuthConfig({
      ADMIN_AUTH_SESSION_LIFETIME_SECONDS: "60",
      ADMIN_AUTH_SESSION_IDLE_SECONDS: "61"
    })).toThrow("cannot exceed");
    expect(() => loadAdministratorAuthConfig({
      ADMIN_AUTH_SECURITY_SECRET: "short"
    })).toThrow("32 bytes");
  });
});
