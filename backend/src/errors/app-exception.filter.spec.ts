import { ArgumentsHost, HttpStatus } from "@nestjs/common";

import { AppLogger } from "../logging";
import { AppError } from "./app-error";
import { AppExceptionFilter } from "./app-exception.filter";

describe("AppExceptionFilter", () => {
  it("writes standard error responses and logs expected app errors as warnings", () => {
    const logger = createMockLogger();
    const response = createMockResponse();
    const host = createMockHost(response);
    const filter = new AppExceptionFilter(logger);

    filter.catch(
      new AppError({
        code: "VALIDATION_FAILED",
        message: "Invalid request.",
        statusCode: HttpStatus.BAD_REQUEST,
        details: [
          {
            message: "gameType is required",
            path: "gameType"
          }
        ]
      }),
      host
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "VALIDATION_FAILED",
        message: "Invalid request.",
        requestId: "request-1",
        details: [
          {
            message: "gameType is required",
            path: "gameType"
          }
        ]
      })
    );
    expect(logger.warning).toHaveBeenCalledWith(
      "Invalid request.",
      expect.objectContaining({
        component: "AppExceptionFilter",
        operation: "handleException",
        requestId: "request-1"
      })
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs unknown failures as errors and returns a generic response", () => {
    const logger = createMockLogger();
    const response = createMockResponse();
    const host = createMockHost(response);
    const filter = new AppExceptionFilter(logger);

    filter.catch(new Error("Unexpected database failure"), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        details: []
      })
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Unhandled request error",
      expect.objectContaining({
        component: "AppExceptionFilter",
        operation: "handleException",
        requestId: "request-1"
      })
    );
  });

  it("sets Retry-After without logging URL query values", () => {
    const logger = createMockLogger();
    const response = createMockResponse();
    const host = createMockHost(response, "/api/admin/auth/login?token=secret");
    const filter = new AppExceptionFilter(logger);

    filter.catch(new AppError({
      code: "RATE_LIMITED",
      message: "Try again later.",
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      details: [{
        message: "Authentication attempts are temporarily limited.",
        metadata: { retryAfterSeconds: 60 }
      }]
    }), host);

    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "60");
    expect(logger.warning).toHaveBeenCalledWith(
      "Try again later.",
      expect.objectContaining({
        metadata: expect.objectContaining({
          path: "/api/admin/auth/login"
        })
      })
    );
    expect(logger.warning).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          url: expect.stringContaining("secret")
        })
      })
    );
  });
});

function createMockLogger(): jest.Mocked<AppLogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn()
  };
}

function createMockResponse(): {
  setHeader: jest.Mock;
  status: jest.Mock;
  json: jest.Mock;
} {
  const response = {
    setHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn()
  };
  response.status.mockReturnValue(response);
  return response;
}

function createMockHost(response: {
  setHeader: jest.Mock;
  status: jest.Mock;
  json: jest.Mock;
}, url = "/api/tournaments/active"): ArgumentsHost {
  const request = {
    method: "GET",
    url,
    headers: {
      "x-request-id": "request-1"
    }
  };

  return {
    switchToHttp: () => ({
      getRequest: <T = unknown>() => request as T,
      getResponse: <T = unknown>() => response as T,
      getNext: jest.fn()
    }),
    getArgByIndex: jest.fn(),
    getArgs: jest.fn(),
    getType: jest.fn(),
    switchToRpc: jest.fn(),
    switchToWs: jest.fn()
  };
}
