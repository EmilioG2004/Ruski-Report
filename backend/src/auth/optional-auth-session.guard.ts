import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";

import { AuthService, unauthorizedSessionError } from "./auth.service";
import { AuthenticatedRequest } from "./authenticated-request";
import { parseBearerToken } from "./bearer-token";
import { SessionTokenService } from "./session-token.service";

@Injectable()
export class OptionalAuthSessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: SessionTokenService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = parseBearerToken(request);
    if (token.status === "missing") {
      return true;
    }
    if (token.status === "malformed") {
      throw unauthorizedSessionError();
    }

    request.principal = await this.auth.authenticate(token.token);
    request.sessionTokenHash = this.tokens.hash(token.token);
    return true;
  }
}
