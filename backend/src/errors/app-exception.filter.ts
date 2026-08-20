import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Inject
} from "@nestjs/common";

import { APP_LOGGER, AppLogger } from "../logging";
import { AppError } from "./app-error";
import { createErrorResponse } from "./error-response.factory";

interface RequestLike {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
}

interface ResponseLike {
  setHeader?(name: string, value: string): unknown;
  status(statusCode: number): {
    json(body: unknown): unknown;
  };
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(@Inject(APP_LOGGER) private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestLike>();
    const response = http.getResponse<ResponseLike>();
    const requestId = extractRequestId(request);
    const errorResponse = createErrorResponse(exception, requestId);

    this.writeRateLimitHeader(exception, response);
    this.logException(exception, request, requestId, errorResponse.statusCode);

    response.status(errorResponse.statusCode).json(errorResponse.body);
  }

  private writeRateLimitHeader(
    exception: unknown,
    response: ResponseLike
  ): void {
    if (!(exception instanceof AppError) || exception.code !== "RATE_LIMITED") {
      return;
    }

    const retryAfter = exception.details
      .map((detail) => detail.metadata?.retryAfterSeconds)
      .find((value) =>
        typeof value === "number" && Number.isSafeInteger(value) && value > 0
      );
    if (typeof retryAfter === "number") {
      response.setHeader?.("Retry-After", String(retryAfter));
    }
  }

  private logException(
    exception: unknown,
    request: RequestLike,
    requestId: string | undefined,
    statusCode: number
  ): void {
    const context = {
      component: "AppExceptionFilter",
      operation: "handleException",
      requestId,
      metadata: {
        method: request.method,
        path: request.url?.split("?", 1)[0],
        statusCode
      }
    };

    if (exception instanceof AppError && statusCode < 500) {
      this.logger.warning(exception.message, {
        ...context,
        error: exception
      });
      return;
    }

    this.logger.error("Unhandled request error", {
      ...context,
      error: exception instanceof Error ? exception : undefined,
      metadata: {
        ...context.metadata,
        exception:
          exception instanceof Error ? undefined : String(exception)
      }
    });
  }
}

function extractRequestId(request: RequestLike): string | undefined {
  const value = request.headers?.["x-request-id"];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}
