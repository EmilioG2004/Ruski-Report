import { LogContext } from "./log-context";

export const APP_LOGGER = Symbol("APP_LOGGER");

export interface AppLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warning(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}
