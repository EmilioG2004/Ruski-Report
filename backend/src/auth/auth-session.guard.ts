import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";

import { AuthService, unauthorizedSessionError } from "./auth.service";
import { AuthenticatedRequest } from "./authenticated-request";
import { readBearerToken } from "./bearer-token";
import { SessionTokenService } from "./session-token.service";

@Injectable()
export class AuthSessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: SessionTokenService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawToken = readBearerToken(request);
    if (rawToken === undefined) {
      throw unauthorizedSessionError();
    }

    request.principal = await this.auth.authenticate(rawToken);
    request.sessionTokenHash = this.tokens.hash(rawToken);
    return true;
  }
}
