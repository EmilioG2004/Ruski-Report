import { HttpException, HttpStatus, Logger } from "@nestjs/common";
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter
} from "@nestjs/common";

import { createErrorResponse } from "../../errors";
import { safeAdministratorRequestId } from "../security";
import { renderErrorPage } from "./admin-web.html";
import {
  ADMIN_WEB_ROOT,
  AdminWebPageError,
  AdminWebRequest,
  AdminWebResponse,
  redirectAdmin,
  sendAdminErrorHtml
} from "./admin-web.types";

export function adminWebPageError(error: unknown): AdminWebPageError {
  const envelope = createErrorResponse(error);
  return {
    statusCode: envelope.statusCode,
    message: envelope.body.message,
    details: envelope.body.details
  };
}

export function isExpectedWebError(error: unknown): boolean {
  if (error instanceof HttpException) {
    return error.getStatus() < HttpStatus.INTERNAL_SERVER_ERROR;
  }
  return adminWebPageError(error).statusCode < HttpStatus.INTERNAL_SERVER_ERROR;
}

@Catch()
export class AdministratorWebExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AdministratorWebExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<AdminWebRequest>();
    const response = http.getResponse<AdminWebResponse>();
    const error = adminWebPageError(exception);

    if (error.statusCode === HttpStatus.UNAUTHORIZED) {
      redirectAdmin(response, `${ADMIN_WEB_ROOT}/sign-in`);
      return;
    }
    if (error.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        "Administrator web request failed.",
        sanitizedRequestLogContext(request)
      );
    }
    sendAdminErrorHtml(response, renderErrorPage(error), error);
  }
}

function sanitizedRequestLogContext(request: AdminWebRequest): {
  method?: string;
  path?: string;
  requestId?: string;
} {
  const method = request.method?.toUpperCase();
  const path = request.url?.split(/[?#]/u, 1)[0];
  const requestIdValue = request.headers?.["x-request-id"];
  const requestId = Array.isArray(requestIdValue)
    ? requestIdValue[0]
    : requestIdValue;
  return {
    ...(
      method !== undefined &&
      ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
        .includes(method)
        ? { method }
        : {}
    ),
    ...(
      path !== undefined &&
      path.length <= 240 &&
      /^\/api\/admin\/app(?:\/[A-Za-z0-9._~-]+)*\/?$/u.test(path)
        ? { path }
        : {}
    ),
    ...(
      safeAdministratorRequestId(requestId) !== undefined
        ? { requestId: safeAdministratorRequestId(requestId) }
        : {}
    )
  };
}
