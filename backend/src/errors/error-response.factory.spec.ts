import { BadRequestException, HttpStatus, NotFoundException } from "@nestjs/common";

import { AppError } from "./app-error";
import { createErrorResponse } from "./error-response.factory";

describe("createErrorResponse", () => {
  it("maps AppError to the standard response shape", () => {
    const response = createErrorResponse(
      new AppError({
        code: "SCOREBOOK_VALIDATION_FAILED",
        message: "Scorebook could not be published.",
        statusCode: HttpStatus.BAD_REQUEST,
        details: [
          {
            code: "MISSING_TAB",
            message: "Required tab is missing.",
            path: "sheets.Regular Season Standings"
          }
        ]
      }),
      "request-1"
    );

    expect(response.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body).toMatchObject({
      code: "SCOREBOOK_VALIDATION_FAILED",
      message: "Scorebook could not be published.",
      requestId: "request-1",
      details: [
        {
          code: "MISSING_TAB",
          message: "Required tab is missing.",
          path: "sheets.Regular Season Standings"
        }
      ]
    });
    expect(response.body.timestamp).toEqual(expect.any(String));
  });

  it("maps Nest validation-style HttpException messages into details", () => {
    const response = createErrorResponse(
      new BadRequestException(["year must be numeric", "gameType is required"])
    );

    expect(response.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body).toMatchObject({
      code: "BAD_REQUEST",
      message: "year must be numeric; gameType is required",
      details: [
        {
          message: "year must be numeric"
        },
        {
          message: "gameType is required"
        }
      ]
    });
  });

  it("maps common Nest HTTP exceptions to stable error codes", () => {
    const response = createErrorResponse(new NotFoundException("Match not found"));

    expect(response.statusCode).toBe(HttpStatus.NOT_FOUND);
    expect(response.body).toMatchObject({
      code: "NOT_FOUND",
      message: "Match not found"
    });
  });

  it("hides unknown errors behind an internal error response", () => {
    const response = createErrorResponse(new Error("Database password leaked"));

    expect(response.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.body).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      details: []
    });
  });
});
