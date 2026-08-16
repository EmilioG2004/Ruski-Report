import { HttpException, HttpStatus } from "@nestjs/common";

import { AppError } from "./app-error";
import { ErrorCode } from "./error-code";
import { ErrorDetail, ErrorResponseEnvelope } from "./error-response";

export function createErrorResponse(
  error: unknown,
  requestId?: string
): ErrorResponseEnvelope {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId,
        timestamp: new Date().toISOString()
      }
    };
  }

  if (error instanceof HttpException) {
    const statusCode = error.getStatus();

    return {
      statusCode,
      body: {
        code: mapHttpStatusToErrorCode(statusCode),
        message: extractHttpExceptionMessage(error),
        details: extractHttpExceptionDetails(error),
        requestId,
        timestamp: new Date().toISOString()
      }
    };
  }

  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    body: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      details: [],
      requestId,
      timestamp: new Date().toISOString()
    }
  };
}

function mapHttpStatusToErrorCode(statusCode: number): ErrorCode {
  switch (statusCode) {
    case HttpStatus.BAD_REQUEST:
      return "BAD_REQUEST";
    case HttpStatus.UNAUTHORIZED:
      return "UNAUTHORIZED";
    case HttpStatus.FORBIDDEN:
      return "FORBIDDEN";
    case HttpStatus.NOT_FOUND:
      return "NOT_FOUND";
    default:
      return statusCode >= 400 && statusCode < 500
        ? "BAD_REQUEST"
        : "INTERNAL_ERROR";
  }
}

function extractHttpExceptionMessage(error: HttpException): string {
  const response = error.getResponse();

  if (typeof response === "string") {
    return response;
  }

  if (isHttpExceptionObject(response)) {
    const message = response.message;

    if (Array.isArray(message)) {
      return message.join("; ");
    }

    if (typeof message === "string") {
      return message;
    }
  }

  return error.message;
}

function extractHttpExceptionDetails(error: HttpException): ErrorDetail[] {
  const response = error.getResponse();

  if (!isHttpExceptionObject(response)) {
    return [];
  }

  if (Array.isArray(response.message)) {
    return response.message.map((message) => ({
      message
    }));
  }

  return [];
}

function isHttpExceptionObject(
  response: string | object
): response is { message?: string | string[] } {
  return typeof response === "object" && response !== null;
}
