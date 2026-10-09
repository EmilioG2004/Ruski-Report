import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";

import { administratorUnauthorizedError } from "./administrator-security.errors";
import {
  AdministratorAuthenticatedRequest,
  administratorRequestContext
} from "./administrator-authenticated-request";
import { readAdministratorCookie } from "./administrator-cookies";
import { AdministratorSecurityAuditService } from "./administrator-security-audit.service";
import { AdministratorSecurityService } from "./administrator-security.service";
import { ADMIN_AUTH_CONFIG, AdministratorAuthConfig } from "../../config/admin-auth.config";
import { Inject } from "@nestjs/common";

@Injectable()
export class AdministratorSessionGuard implements CanActivate {
  constructor(
    private readonly security: AdministratorSecurityService,
    private readonly audit: AdministratorSecurityAuditService,
    @Inject(ADMIN_AUTH_CONFIG)
    private readonly config: AdministratorAuthConfig
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp()
      .getRequest<AdministratorAuthenticatedRequest>();
    const rawToken = readAdministratorCookie(
      request,
      this.config.sessionCookieName
    );
    if (rawToken === undefined) {
      await this.recordRejected(request, "missing_or_malformed_session");
      throw administratorUnauthorizedError();
    }

    try {
      const authenticated = await this.security.authenticateSession(rawToken);
      request.administratorPrincipal = authenticated.principal;
      request.administratorCsrfTokenHash = authenticated.csrfTokenHash;
      return true;
    } catch (error) {
      await this.recordRejected(request, "inactive_session");
      throw error;
    }
  }

  private async recordRejected(
    request: AdministratorAuthenticatedRequest,
    reasonCode: string
  ): Promise<void> {
    try {
      await this.audit.recordEvent({
        eventType: "administrator_session_authenticated",
        outcome: "rejected",
        reasonCode,
        ...administratorRequestContext(request)
      });
    } catch {
      // Authentication remains denied if audit storage is unavailable.
    }
  }
}
