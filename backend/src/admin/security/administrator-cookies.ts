import { AdministratorAuthConfig } from "../../config/admin-auth.config";

export interface AdministratorCookieRequest {
  headers?: Record<string, string | string[] | undefined>;
}

export interface AdministratorCookieResponse {
  append(name: string, value: string): unknown;
}

export function readAdministratorCookie(
  request: AdministratorCookieRequest,
  name: string
): string | undefined {
  const value = request.headers?.cookie;
  const header = Array.isArray(value) ? value.join("; ") : value;
  if (header === undefined) {
    return undefined;
  }

  const matches = header.split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) {
      return [];
    }
    return [part.slice(separator + 1).trim()];
  });
  return matches.length === 1 && /^[A-Za-z0-9_.-]+$/.test(matches[0])
    ? matches[0]
    : undefined;
}

export function setAdministratorSessionCookies(
  response: AdministratorCookieResponse,
  config: AdministratorAuthConfig,
  sessionToken: string,
  csrfToken: string,
  expiresAt: string
): void {
  const expires = new Date(expiresAt);
  response.append("Set-Cookie", serializeCookie(
    config.sessionCookieName,
    sessionToken,
    config,
    expires,
    true
  ));
  response.append("Set-Cookie", serializeCookie(
    config.csrfCookieName,
    csrfToken,
    config,
    expires,
    false
  ));
  response.append("Set-Cookie", serializeCookie(
    config.preAuthCsrfCookieName,
    "deleted",
    config,
    new Date(0),
    false
  ));
}

export function setPreAuthCsrfCookie(
  response: AdministratorCookieResponse,
  config: AdministratorAuthConfig,
  csrfToken: string,
  expiresAt: string
): void {
  response.append("Set-Cookie", serializeCookie(
    config.preAuthCsrfCookieName,
    csrfToken,
    config,
    new Date(expiresAt),
    false
  ));
}

export function clearAdministratorCookies(
  response: AdministratorCookieResponse,
  config: AdministratorAuthConfig
): void {
  const expired = new Date(0);
  response.append("Set-Cookie", serializeCookie(
    config.sessionCookieName,
    "deleted",
    config,
    expired,
    true
  ));
  response.append("Set-Cookie", serializeCookie(
    config.csrfCookieName,
    "deleted",
    config,
    expired,
    false
  ));
  response.append("Set-Cookie", serializeCookie(
    config.preAuthCsrfCookieName,
    "deleted",
    config,
    expired,
    false
  ));
}

function serializeCookie(
  name: string,
  value: string,
  config: AdministratorAuthConfig,
  expiresAt: Date,
  httpOnly: boolean
): string {
  const maximumAge = Math.max(
    0,
    Math.floor((expiresAt.getTime() - Date.now()) / 1_000)
  );
  return [
    `${name}=${value}`,
    "Path=/",
    `Expires=${expiresAt.toUTCString()}`,
    `Max-Age=${maximumAge}`,
    "SameSite=Strict",
    config.secureCookies ? "Secure" : undefined,
    httpOnly ? "HttpOnly" : undefined
  ].filter((part): part is string => part !== undefined).join("; ");
}
