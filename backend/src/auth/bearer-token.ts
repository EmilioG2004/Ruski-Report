import { AuthenticatedRequest } from "./authenticated-request";

export function readBearerToken(
  request: AuthenticatedRequest
): string | undefined {
  const authorization = request.headers?.authorization;
  const value = Array.isArray(authorization) ? authorization[0] : authorization;

  if (value === undefined) {
    return undefined;
  }

  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(value);
  return match?.[1];
}
