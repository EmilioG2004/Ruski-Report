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
        requestId: "00000000-0000-4000-8000-000000000001",
        details: [
          {
            message: "gameType is required",
            path: "gameType"
          }
        ]
      })
    );
    expect(logger.warning).toHaveBeenCalledWith(
      "Request rejected.",
      expect.objectContaining({
        component: "AppExceptionFilter",
        operation: "handleException",
        requestId: "00000000-0000-4000-8000-000000000001",
        metadata: expect.objectContaining({ errorCode: "VALIDATION_FAILED" })
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
      "Unhandled request error.",
      expect.objectContaining({
        component: "AppExceptionFilter",
        operation: "handleException",
        requestId: "00000000-0000-4000-8000-000000000001"
      })
    );
  });

  it("sets Retry-After without logging URL or query values", () => {
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
      "Request rejected.",
      expect.objectContaining({
        metadata: expect.objectContaining({
          errorCode: "RATE_LIMITED"
        })
      })
    );
    expect(logger.warning).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          path: expect.anything()
        })
      })
    );
  });

  it("omits attacker-controlled request paths and non-UUID request IDs from logs", () => {
    const logger = createMockLogger();
    const filter = new AppExceptionFilter(logger);
    const response = createMockResponse();
    const host = createMockHost(
      response,
      "/api/private-canary-path?value=private-canary-query",
      "private-canary-request-id"
    );

    filter.catch(new AppError({
      code: "BAD_REQUEST",
      message: "private-canary-message",
      statusCode: HttpStatus.BAD_REQUEST
    }), host);

    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain("private-canary");
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
}, url = "/api/tournaments/active",
requestId = "00000000-0000-4000-8000-000000000001"): ArgumentsHost {
  const request = {
    method: "GET",
    url,
    headers: {
      "x-request-id": requestId
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
