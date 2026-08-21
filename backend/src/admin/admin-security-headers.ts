export interface AdminHeaderResponse {
  setHeader(name: string, value: string): unknown;
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'self'",
  "img-src 'self' data:",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
].join("; ");

export function applyAdminSecurityHeaders(
  response: AdminHeaderResponse,
  production: boolean
): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Permissions-Policy", [
    "camera=()",
    "geolocation=()",
    "microphone=()",
    "payment=()",
    "usb=()"
  ].join(", "));
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");

  if (production) {
    response.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000"
    );
  }
}
