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

    this.logException(exception, request, requestId, errorResponse.statusCode);

    response.status(errorResponse.statusCode).json(errorResponse.body);
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
        url: request.url,
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
