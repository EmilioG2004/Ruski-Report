import { loadAuthConfig } from "./auth.config";

describe("auth config", () => {
  it("provides secure production defaults", () => {
    const config = loadAuthConfig({});

    expect(config).toMatchObject({
      maximumDisplayNameLength: 40,
      minimumPasswordLength: 10,
      maximumPasswordLength: 128,
      sessionLifetimeSeconds: 2_592_000,
      passwordHash: {
        cost: 16_384,
        saltLength: 16
      },
      sessionTokenLength: 32
    });
  });

  it("reads deploy-time overrides", () => {
    const config = loadAuthConfig({
      AUTH_MIN_PASSWORD_LENGTH: "12",
      AUTH_SESSION_LIFETIME_SECONDS: "7200",
      AUTH_SCRYPT_COST: "32768",
      AUTH_SESSION_TOKEN_LENGTH: "48"
    });

    expect(config.minimumPasswordLength).toBe(12);
    expect(config.sessionLifetimeSeconds).toBe(7200);
    expect(config.passwordHash.cost).toBe(32768);
    expect(config.sessionTokenLength).toBe(48);
  });

  it("rejects invalid numeric values", () => {
    expect(() =>
      loadAuthConfig({ AUTH_SESSION_LIFETIME_SECONDS: "never" })
    ).toThrow("AUTH_SESSION_LIFETIME_SECONDS must be a positive integer.");
  });

  it("rejects inconsistent password and scrypt settings", () => {
    expect(() =>
      loadAuthConfig({
        AUTH_MIN_PASSWORD_LENGTH: "20",
        AUTH_MAX_PASSWORD_LENGTH: "10"
      })
    ).toThrow(
      "AUTH_MIN_PASSWORD_LENGTH cannot exceed AUTH_MAX_PASSWORD_LENGTH."
    );
    expect(() => loadAuthConfig({ AUTH_SCRYPT_COST: "1000" })).toThrow(
      "AUTH_SCRYPT_COST must be a power of two between 2 and 1048576."
    );
  });
});
