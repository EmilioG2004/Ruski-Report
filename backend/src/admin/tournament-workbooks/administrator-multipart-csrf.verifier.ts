import { timingSafeEqual } from "node:crypto";

import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable
} from "@nestjs/common";

import { AppError } from "../../errors";
import {
  ADMIN_AUTH_CONFIG,
  AdministratorAuthConfig,
  AdministratorAuthenticatedRequest,
  AdministratorSecurityAuditService,
  AdministratorSecurityService,
  administratorRequestContext,
  headerValue,
  readAdministratorCookie
} from "../security";

@Injectable()
export class AdministratorMultipartOriginGuard implements CanActivate {
  constructor(
    private readonly audit: AdministratorSecurityAuditService,
    @Inject(ADMIN_AUTH_CONFIG)
    private readonly config: AdministratorAuthConfig
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp()
      .getRequest<AdministratorAuthenticatedRequest>();
    if (request.administratorPrincipal !== undefined &&
        headerValue(request, "origin") === this.config.origin) {
      return true;
    }
    try {
      await this.audit.recordEvent({
        eventType: "administrator_csrf_verified",
        outcome: "rejected",
        reasonCode: "ADMIN_MULTIPART_ORIGIN_INVALID",
        administratorId: request.administratorPrincipal?.administratorId,
        sessionId: request.administratorPrincipal?.sessionId,
        ...administratorRequestContext(request)
      });
    } catch {
      // The upload remains rejected if audit persistence is unavailable.
    }
    throw multipartForbidden("ADMIN_MULTIPART_ORIGIN_INVALID");
  }
}

@Injectable()
export class AdministratorMultipartCsrfVerifier {
  constructor(
    private readonly security: AdministratorSecurityService,
    private readonly audit: AdministratorSecurityAuditService,
    @Inject(ADMIN_AUTH_CONFIG)
    private readonly config: AdministratorAuthConfig
  ) {}

  async verify(request: AdministratorAuthenticatedRequest): Promise<void> {
    const principal = request.administratorPrincipal;
    const headerToken = headerValue(request, "x-csrf-token");
    const formToken = typeof request.body?._csrf === "string"
      ? request.body._csrf
      : undefined;
    const suppliedToken = headerToken ?? formToken;
    const cookieToken = readAdministratorCookie(request, this.config.csrfCookieName);
    const valid = principal !== undefined &&
      headerValue(request, "origin") === this.config.origin &&
      suppliedToken !== undefined &&
      cookieToken !== undefined &&
      request.administratorCsrfTokenHash !== undefined &&
      safeEqual(suppliedToken, cookieToken) &&
      this.security.verifyAuthenticatedCsrf(
        suppliedToken,
        request.administratorCsrfTokenHash
      );
    if (valid) {
      return;
    }

    try {
      await this.audit.recordEvent({
        eventType: "administrator_csrf_verified",
        outcome: "rejected",
        reasonCode: "ADMIN_MULTIPART_CSRF_INVALID",
        administratorId: principal?.administratorId,
        sessionId: principal?.sessionId,
        ...administratorRequestContext(request)
      });
    } catch {
      // The upload remains rejected if audit persistence is unavailable.
    }
    throw multipartForbidden("ADMIN_MULTIPART_CSRF_INVALID");
  }
}

function multipartForbidden(detailCode: string): AppError {
  return new AppError({
    code: "FORBIDDEN",
    message: "The administrator request could not be verified.",
    statusCode: 403,
    details: [{
      code: detailCode,
      message: "The administrator request could not be verified."
    }]
  });
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes);
}
