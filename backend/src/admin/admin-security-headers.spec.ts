import { applyAdminSecurityHeaders } from "./admin-security-headers";

describe("administrator security headers", () => {
  it("locks down every private administrator response", () => {
    const headers = new Map<string, string>();

    applyAdminSecurityHeaders({
      setHeader: (name, value) => headers.set(name, value)
    }, false);

    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(headers.get("Content-Security-Policy")).toContain(
      "script-src"
    );
    expect(headers.get("Content-Security-Policy")).not.toContain(
      "'unsafe-inline'"
    );
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.has("Strict-Transport-Security")).toBe(false);
  });

  it("adds HSTS only for production HTTPS operation", () => {
    const headers = new Map<string, string>();

    applyAdminSecurityHeaders({
      setHeader: (name, value) => headers.set(name, value)
    }, true);

    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000"
    );
  });
});
