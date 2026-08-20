import { createParamDecorator, ExecutionContext } from "@nestjs/common";

import { AdministratorPrincipal } from "./administrator-security.types";

export interface AdministratorAuthenticatedRequest {
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown> | null;
  ip?: string;
  socket?: { remoteAddress?: string };
  administratorPrincipal?: AdministratorPrincipal;
  administratorCsrfTokenHash?: string;
}

export const CurrentAdministratorPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdministratorPrincipal => {
    const request = context.switchToHttp()
      .getRequest<AdministratorAuthenticatedRequest>();
    if (request.administratorPrincipal === undefined) {
      throw new Error("Administrator principal is missing from the request.");
    }
    return request.administratorPrincipal;
  }
);

export function administratorRequestContext(
  request: AdministratorAuthenticatedRequest
): {
  requestId?: string;
  networkIdentity?: string;
  userAgent?: string;
} {
  return {
    requestId: headerValue(request, "x-request-id"),
    networkIdentity: request.ip ?? request.socket?.remoteAddress,
    userAgent: headerValue(request, "user-agent")
  };
}

export function headerValue(
  request: AdministratorAuthenticatedRequest,
  name: string
): string | undefined {
  const value = request.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}
