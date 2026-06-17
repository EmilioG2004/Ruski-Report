import { HttpStatus } from "@nestjs/common";

import { ErrorCode } from "./error-code";
import { ErrorDetail } from "./error-response";

export interface AppErrorOptions {
  code: ErrorCode;
  message: string;
  statusCode?: number;
  details?: ErrorDetail[];
  cause?: Error;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: ErrorDetail[];
  override readonly cause?: Error;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = "AppError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
    this.details = options.details ?? [];
    this.cause = options.cause;
  }
}
