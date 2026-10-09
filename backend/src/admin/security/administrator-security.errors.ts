import { HttpStatus } from "@nestjs/common";

import { AppError } from "../../errors";

export function administratorUnauthorizedError(): AppError {
  return new AppError({
    code: "UNAUTHORIZED",
    message: "Sign in as an administrator to continue.",
    statusCode: HttpStatus.UNAUTHORIZED,
    details: [{
      code: "ADMIN_AUTHENTICATION_REQUIRED",
      message: "Administrator authentication is required."
    }]
  });
}

export function invalidAdministratorCredentialsError(): AppError {
  return new AppError({
    code: "UNAUTHORIZED",
    message: "Administrator login name or password is incorrect.",
    statusCode: HttpStatus.UNAUTHORIZED,
    details: [{
      code: "ADMIN_CREDENTIALS_INVALID",
      message: "Administrator credentials are invalid."
    }]
  });
}

export function administratorCsrfError(reasonCode = "ADMIN_CSRF_INVALID"): AppError {
  return new AppError({
    code: "FORBIDDEN",
    message: "Administrator request verification failed.",
    statusCode: HttpStatus.FORBIDDEN,
    details: [{
      code: reasonCode,
      message: "Administrator request verification failed."
    }]
  });
}

export function administratorRateLimitedError(retryAfterSeconds: number): AppError {
  return new AppError({
    code: "RATE_LIMITED",
    message: "Too many administrator requests. Try again later.",
    statusCode: HttpStatus.TOO_MANY_REQUESTS,
    details: [{
      code: "ADMIN_RATE_LIMITED",
      message: "The administrator request rate limit was exceeded.",
      metadata: { retryAfterSeconds }
    }]
  });
}

export function invalidAdministratorInputError(
  code: string,
  message: string,
  path?: string
): AppError {
  return new AppError({
    code: "BAD_REQUEST",
    message,
    statusCode: HttpStatus.BAD_REQUEST,
    details: [{ code, message, path }]
  });
}

export function invalidAdministratorTokenError(): AppError {
  return new AppError({
    code: "BAD_REQUEST",
    message: "The administrator token is invalid or no longer available.",
    statusCode: HttpStatus.BAD_REQUEST,
    details: [{
      code: "ADMIN_TOKEN_INVALID",
      message: "The administrator token is invalid or no longer available."
    }]
  });
}

export function recentAuthenticationRequiredError(): AppError {
  return new AppError({
    code: "FORBIDDEN",
    message: "Sign in again before performing this sensitive action.",
    statusCode: HttpStatus.FORBIDDEN,
    details: [{
      code: "ADMIN_RECENT_AUTHENTICATION_REQUIRED",
      message: "Recent administrator authentication is required."
    }]
  });
}

export function administratorConflictError(message: string): AppError {
  return new AppError({
    code: "CONFLICT",
    message,
    statusCode: HttpStatus.CONFLICT,
    details: [{ code: "ADMIN_IDENTITY_CONFLICT", message }]
  });
}
