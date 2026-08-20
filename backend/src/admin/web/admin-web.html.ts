import { ErrorDetail } from "../../errors";
import { AdministratorPrincipal } from "../security";
import { ADMIN_WEB_ROOT, AdminWebPageError } from "./admin-web.types";

export interface AdminPageChrome {
  title: string;
  content: string;
  principal?: AdministratorPrincipal;
  csrfToken?: string;
}

export function renderAdminPage(page: AdminPageChrome): string {
  const authenticated = page.principal !== undefined;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.title)} · Ruski Report Admin</title>
  <link rel="stylesheet" href="${ADMIN_WEB_ROOT}/assets/admin.css">
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <header class="site-header">
    <div>
      <p class="eyebrow">Ruski Report</p>
      <p class="site-title">Tournament operations</p>
    </div>
    ${authenticated ? renderAuthenticatedNavigation(page) : ""}
  </header>
  <main id="main-content" tabindex="-1">${page.content}</main>
  <footer><p>Private administrator application.</p></footer>
</body>
</html>`;
}

export function renderErrorPage(error: AdminWebPageError): string {
  return renderAdminPage({
    title: "Request could not be completed",
    content: `<section class="panel narrow">
      <p class="eyebrow">Error ${error.statusCode}</p>
      <h1>Request could not be completed</h1>
      <p>${escapeHtml(error.message)}</p>
      ${renderErrorSummary(error.details)}
      <p><a class="button secondary" href="${ADMIN_WEB_ROOT}">Return to administrator home</a></p>
    </section>`
  });
}

export function renderErrorSummary(
  details: readonly ErrorDetail[],
  linkPrefix = ""
): string {
  if (details.length === 0) {
    return "";
  }
  return `<section class="error-summary" role="alert" aria-labelledby="error-summary-title">
    <h2 id="error-summary-title">Please correct the following</h2>
    <ul>${details.map((detail) => {
      const message = escapeHtml(detail.message);
      if (detail.path === undefined) {
        return `<li>${message}</li>`;
      }
      return `<li><a href="${escapeAttribute(linkPrefix)}#${fieldId(detail.path)}">${message}</a></li>`;
    }).join("")}</ul>
  </section>`;
}

export function fieldError(
  details: readonly ErrorDetail[],
  path: string
): string {
  const matching = details.filter((detail) => detail.path === path);
  if (matching.length === 0) {
    return "";
  }
  return `<ul id="${fieldId(path)}-errors" class="field-errors">${matching
    .map((detail) => `<li>${escapeHtml(detail.message)}</li>`).join("")}</ul>`;
}

export function errorDescription(
  details: readonly ErrorDetail[],
  path: string
): string {
  return details.some((detail) => detail.path === path)
    ? ` aria-describedby="${fieldId(path)}-errors" aria-invalid="true"`
    : "";
}

export function fieldId(path: string): string {
  const targetPath = issueTargetPath(path);
  return `field-${targetPath.replace(/[^A-Za-z0-9]+/g, "-")}`;
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const escapeAttribute = escapeHtml;

export function formatLifecycle(value: string): string {
  return value.split("_").map((part) =>
    part.length === 0 ? part : `${part[0].toUpperCase()}${part.slice(1)}`
  ).join(" ");
}

export function formatTimestamp(value: string | null): string {
  if (value === null) {
    return "Not yet";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? escapeHtml(value)
    : `<time datetime="${escapeAttribute(date.toISOString())}">${escapeHtml(
      date.toISOString().replace("T", " ").replace(".000Z", " UTC")
    )}</time>`;
}

function renderAuthenticatedNavigation(page: AdminPageChrome): string {
  if (page.principal === undefined || page.csrfToken === undefined) {
    throw new Error("Authenticated administrator pages require a CSRF token.");
  }
  return `<nav aria-label="Administrator">
    <a href="${ADMIN_WEB_ROOT}/tournaments">Tournaments</a>
    <span class="operator">Signed in as ${escapeHtml(page.principal.displayName)}</span>
    <form method="post" action="${ADMIN_WEB_ROOT}/sign-out">
      <input type="hidden" name="_csrf" value="${escapeAttribute(page.csrfToken)}">
      <button class="link-button" type="submit">Sign out</button>
    </form>
  </nav>`;
}

function issueTargetPath(path: string): string {
  if (path === "teams.playerIds" || path === "teams.players") {
    return "teams";
  }
  if (/^teams\.\d+\.playerIds$/.test(path)) {
    return path.replace(/\.playerIds$/, "");
  }
  if (path === "pods.sequence") {
    return "pods";
  }
  if (path === "pods.teamAssignments" ||
      /^pods\.\d+\.teamAssignments/.test(path)) {
    return "teams";
  }
  if (path === "configuration.value.podSizes") {
    return "configuration.value.podSize";
  }
  return path;
}
