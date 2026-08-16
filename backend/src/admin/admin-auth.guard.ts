import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";

import { ADMIN_CONFIG, AdminConfig } from "../config/admin.config";
import { AppError } from "../errors";
import { AdminAuthenticatedRequest } from "./admin-authenticated-request";

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    @Inject(ADMIN_CONFIG)
    private readonly config: AdminConfig
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const expectedToken = this.config.apiToken;

    if (expectedToken === undefined || expectedToken.length === 0) {
      throw new AppError({
        code: "FORBIDDEN",
        message: "Admin API token is not configured.",
        statusCode: HttpStatus.FORBIDDEN
      });
    }

    const request =
      context.switchToHttp().getRequest<AdminAuthenticatedRequest>();
    const suppliedToken = getHeaderValue(request, "x-admin-token");

    if (
      suppliedToken === undefined ||
      !tokensMatch(suppliedToken, expectedToken)
    ) {
      throw new AppError({
        code: "UNAUTHORIZED",
        message: "Admin API token is invalid or missing.",
        statusCode: HttpStatus.UNAUTHORIZED
      });
    }

    request.adminPrincipal = {
      operatorId: this.config.operatorId
    };
    return true;
  }
}

function getHeaderValue(
  request: AdminAuthenticatedRequest,
  headerName: string
): string | undefined {
  const lowerHeader = request.headers?.[headerName];
  const upperHeader = request.headers?.[headerName.toUpperCase()];
  const value = lowerHeader ?? upperHeader;

  return Array.isArray(value) ? value[0] : value;
}

function tokensMatch(supplied: string, expected: string): boolean {
  const suppliedBuffer = Buffer.from(supplied, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}
