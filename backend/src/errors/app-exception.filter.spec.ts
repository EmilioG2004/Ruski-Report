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
  status: jest.Mock;
  json: jest.Mock;
} {
  const response = {
    status: jest.fn(),
    json: jest.fn()
  };
  response.status.mockReturnValue(response);
  return response;
}

function createMockHost(response: {
  status: jest.Mock;
  json: jest.Mock;
}): ArgumentsHost {
  const request = {
    method: "GET",
    url: "/api/tournaments/active",
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
