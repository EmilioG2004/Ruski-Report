import { ErrorDetail } from "../../errors";
import { AdministratorCookieResponse } from "../security";

export const ADMIN_WEB_ROOT = "/api/admin/app";

export interface AdminWebRequest {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown> | null;
  ip?: string;
  socket?: { remoteAddress?: string };
}

export interface AdminWebResponse extends AdministratorCookieResponse {
  status(statusCode: number): AdminWebResponse;
  type(contentType: string): AdminWebResponse;
  send(body: string): unknown;
  redirect(statusCode: number, location: string): unknown;
  setHeader(name: string, value: string): unknown;
}

export interface AdminWebPageError {
  statusCode: number;
  message: string;
  details: readonly ErrorDetail[];
}

export function sendAdminHtml(
  response: AdminWebResponse,
  html: string,
  statusCode = 200
): void {
  response.setHeader("Cache-Control", "no-store");
  response.status(statusCode).type("text/html; charset=utf-8").send(html);
}

export function sendAdminErrorHtml(
  response: AdminWebResponse,
  html: string,
  error: AdminWebPageError
): void {
  const retryAfter = error.details.flatMap((detail) => {
    const value = detail.metadata?.retryAfterSeconds;
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? [value]
      : [];
  })[0];
  if (retryAfter !== undefined) {
    response.setHeader("Retry-After", String(retryAfter));
  }
  sendAdminHtml(response, html, error.statusCode);
}

export function redirectAdmin(
  response: AdminWebResponse,
  location: string
): void {
  response.setHeader("Cache-Control", "no-store");
  response.redirect(303, location);
}
