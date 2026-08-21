import { Injectable } from "@nestjs/common";

import { AppLogger } from "./app-logger";
import { LogContext, LogEntry, LogLevel } from "./log-context";

@Injectable()
export class ConsoleAppLogger implements AppLogger {
  debug(message: string, context?: LogContext): void {
    this.write("debug", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write("info", message, context);
  }

  warning(message: string, context?: LogContext): void {
    this.write("warning", message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write("error", message, context);
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    const entry = createLogEntry(level, message, context);
    const serialized = JSON.stringify(entry);

    if (level === "error") {
      console.error(serialized);
      return;
    }

    if (level === "warning") {
      console.warn(serialized);
      return;
    }

    console.log(serialized);
  }
}

export function createLogEntry(
  level: LogLevel,
  message: string,
  context?: LogContext
): LogEntry {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    component: context?.component,
    operation: context?.operation,
    requestId: context?.requestId,
    gameType: context?.gameType,
    tournamentId: context?.tournamentId,
    matchId: context?.matchId,
    uploadId: context?.uploadId,
    error: context?.error ? serializeError(context.error) : undefined,
    metadata: context?.metadata
  };
}

function serializeError(error: Error): LogEntry["error"] {
  return {
    name: safeErrorName(error.name)
  };
}

function safeErrorName(value: string): string {
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u.test(value) ? value : "Error";
}
