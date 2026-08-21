import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable
} from "@nestjs/common";

import {
  ADMIN_AUTH_CONFIG,
  AdministratorAuthConfig
} from "../../config/admin-auth.config";
import {
  AdministratorAuthenticatedRequest,
  administratorRequestContext,
  headerValue
} from "./administrator-authenticated-request";
import { readAdministratorCookie } from "./administrator-cookies";
import { AdministratorSecurityAuditService } from "./administrator-security-audit.service";
import { administratorCsrfError } from "./administrator-security.errors";
import { AdministratorSecurityService } from "./administrator-security.service";
import { AdministratorSecurityTokens } from "./administrator-security.tokens";

@Injectable()
export class AdministratorCsrfGuard implements CanActivate {
  constructor(
    private readonly security: AdministratorSecurityService,
    private readonly tokens: AdministratorSecurityTokens,
    private readonly audit: AdministratorSecurityAuditService,
    @Inject(ADMIN_AUTH_CONFIG)
    private readonly config: AdministratorAuthConfig
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp()
      .getRequest<AdministratorAuthenticatedRequest>();
    const origin = headerValue(request, "origin");
    if (origin !== this.config.origin) {
      await this.reject(request, "ADMIN_ORIGIN_INVALID");
    }

    const headerToken = headerValue(request, "x-csrf-token");
    const formToken = typeof request.body?._csrf === "string"
      ? request.body._csrf
      : undefined;
    if (headerToken !== undefined && formToken !== undefined &&
        !this.tokens.matches(headerToken, formToken)) {
      await this.reject(request, "ADMIN_CSRF_AMBIGUOUS");
    }
    const suppliedToken = headerToken ?? formToken;
    const cookieToken = readAdministratorCookie(
      request,
      request.administratorPrincipal === undefined
        ? this.config.preAuthCsrfCookieName
        : this.config.csrfCookieName
    );
    if (suppliedToken === undefined || cookieToken === undefined ||
        !this.tokens.matches(suppliedToken, cookieToken)) {
      await this.reject(request, "ADMIN_CSRF_INVALID");
    }

    if (suppliedToken === undefined) {
      throw administratorCsrfError();
    }

    const verified = request.administratorPrincipal === undefined
      ? this.security.verifyPreAuthCsrf(suppliedToken)
      : request.administratorCsrfTokenHash !== undefined &&
        this.security.verifyAuthenticatedCsrf(
          suppliedToken,
          request.administratorCsrfTokenHash
        );
    if (!verified) {
      await this.reject(request, "ADMIN_CSRF_EXPIRED_OR_INVALID");
    }
    return true;
  }

  private async reject(
    request: AdministratorAuthenticatedRequest,
    reasonCode: string
  ): Promise<never> {
    try {
      await this.audit.recordEvent({
        eventType: "administrator_csrf_verified",
        outcome: "rejected",
        reasonCode,
        administratorId: request.administratorPrincipal?.administratorId,
        sessionId: request.administratorPrincipal?.sessionId,
        ...administratorRequestContext(request)
      });
    } catch {
      // Request verification remains denied if audit storage is unavailable.
    }
    throw administratorCsrfError(reasonCode);
  }
}
