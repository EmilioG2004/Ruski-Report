import { Metadata } from "../domain";
import { ErrorCode } from "./error-code";

export interface ErrorDetail {
  code?: string;
  message: string;
  path?: string;
  metadata?: Metadata;
}

export interface ErrorResponse {
  code: ErrorCode;
  message: string;
  details: ErrorDetail[];
  requestId?: string;
  timestamp: string;
}

export interface ErrorResponseEnvelope {
  statusCode: number;
  body: ErrorResponse;
}
