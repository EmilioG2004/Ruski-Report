import { createParamDecorator, ExecutionContext } from "@nestjs/common";

import { AuthenticatedPrincipal } from "../domain";

export interface AuthenticatedRequest {
  headers?: Record<string, string | string[] | undefined>;
  principal?: AuthenticatedPrincipal;
  sessionTokenHash?: string;
}

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.principal === undefined) {
      throw new Error("Authenticated principal is missing from the request.");
    }
    return request.principal;
  }
);

export const CurrentSessionTokenHash = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.sessionTokenHash === undefined) {
      throw new Error("Authenticated session token hash is missing from the request.");
    }
    return request.sessionTokenHash;
  }
);
