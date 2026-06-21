import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable
} from "@nestjs/common";

import { AppError } from "../errors";

interface AdminRequest {
  headers?: Record<string, string | string[] | undefined>;
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expectedToken = process.env.ADMIN_UPLOAD_TOKEN;

    if (expectedToken === undefined || expectedToken.length === 0) {
      throw new AppError({
        code: "FORBIDDEN",
        message: "Admin upload token is not configured.",
        statusCode: HttpStatus.FORBIDDEN
      });
    }

    const request = context.switchToHttp().getRequest<AdminRequest>();
    const suppliedToken = getHeaderValue(request, "x-admin-token");

    if (suppliedToken !== expectedToken) {
      throw new AppError({
        code: "UNAUTHORIZED",
        message: "Admin upload token is invalid or missing.",
        statusCode: HttpStatus.UNAUTHORIZED
      });
    }

    return true;
  }
}

function getHeaderValue(
  request: AdminRequest,
  headerName: string
): string | undefined {
  const lowerHeader = request.headers?.[headerName];
  const upperHeader = request.headers?.[headerName.toUpperCase()];
  const value = lowerHeader ?? upperHeader;

  return Array.isArray(value) ? value[0] : value;
}
