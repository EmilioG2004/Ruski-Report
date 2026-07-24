import { AuthenticatedRequest } from "./authenticated-request";

export type BearerTokenResult =
  | { status: "missing" }
  | { status: "malformed" }
  | { status: "present"; token: string };

export function parseBearerToken(
  request: AuthenticatedRequest
): BearerTokenResult {
  const authorization = request.headers?.authorization;
  const value = Array.isArray(authorization) ? authorization[0] : authorization;

  if (value === undefined) {
    return { status: "missing" };
  }

  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(value);
  return match === null
    ? { status: "malformed" }
    : { status: "present", token: match[1] };
}

export function readBearerToken(
  request: AuthenticatedRequest
): string | undefined {
  const result = parseBearerToken(request);
  return result.status === "present" ? result.token : undefined;
}
