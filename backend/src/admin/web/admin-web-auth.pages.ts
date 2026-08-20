import { ErrorDetail } from "../../errors";
import {
  ADMIN_WEB_ROOT,
  AdminWebPageError
} from "./admin-web.types";
import {
  escapeAttribute,
  fieldError,
  fieldId,
  renderAdminPage,
  renderErrorSummary
} from "./admin-web.html";

export function renderSignInPage(input: {
  csrfToken: string;
  loginName?: string;
  error?: AdminWebPageError;
  recoveryCompleted?: boolean;
}): string {
  const errors = input.error?.details ?? [];
  return renderAdminPage({
    title: "Sign in",
    content: `<section class="panel narrow">
      <p class="eyebrow">Private access</p>
      <h1>Administrator sign in</h1>
      <p>Use your individual tournament-operator identity.</p>
      ${input.recoveryCompleted
        ? `<p class="notice" role="status">Password recovery completed. Sign in with your new password.</p>`
        : ""}
      ${input.error === undefined ? "" : `<p class="error-message" role="alert">${
        escapeAttribute(input.error.message)
      }</p>${renderErrorSummary(errors)}`}
      <form method="post" action="${ADMIN_WEB_ROOT}/sign-in">
        <input type="hidden" name="_csrf" value="${escapeAttribute(input.csrfToken)}">
        ${textField({
          name: "loginName",
          label: "Login name",
          value: input.loginName ?? "",
          autocomplete: "username",
          errors
        })}
        ${textField({
          name: "password",
          label: "Password",
          type: "password",
          autocomplete: "current-password",
          errors
        })}
        <button type="submit">Sign in</button>
      </form>
      <p><a href="${ADMIN_WEB_ROOT}/invitations/accept">Accept an administrator invitation</a></p>
      <p><a href="${ADMIN_WEB_ROOT}/recovery/complete">Complete account recovery</a></p>
    </section>`
  });
}

export function renderInvitationAcceptancePage(input: {
  csrfToken: string;
  error?: AdminWebPageError;
}): string {
  const errors = input.error?.details ?? [];
  return renderAdminPage({
    title: "Accept invitation",
    content: `<section class="panel narrow">
      <p class="eyebrow">One-time setup</p>
      <h1>Accept administrator invitation</h1>
      <p>Paste the single-use token shared with you out of band. It is sent only in this form submission.</p>
      ${input.error === undefined ? "" : `<p class="error-message" role="alert">${
        escapeAttribute(input.error.message)
      }</p>${renderErrorSummary(errors)}`}
      <form method="post" action="${ADMIN_WEB_ROOT}/invitations/accept">
        <input type="hidden" name="_csrf" value="${escapeAttribute(input.csrfToken)}">
        ${textField({
          name: "token",
          label: "Invitation token",
          type: "password",
          autocomplete: "one-time-code",
          errors
        })}
        ${textField({
          name: "password",
          label: "Create password",
          type: "password",
          autocomplete: "new-password",
          help: "Use at least 12 characters.",
          errors
        })}
        <button type="submit">Accept invitation</button>
      </form>
      <p><a href="${ADMIN_WEB_ROOT}/sign-in">Return to sign in</a></p>
    </section>`
  });
}

export function renderRecoveryCompletionPage(input: {
  csrfToken: string;
  error?: AdminWebPageError;
}): string {
  const errors = input.error?.details ?? [];
  return renderAdminPage({
    title: "Complete recovery",
    content: `<section class="panel narrow">
      <p class="eyebrow">Account recovery</p>
      <h1>Set a new administrator password</h1>
      <p>Paste the single-use recovery token shared with you out of band. It is sent only in this form submission.</p>
      ${input.error === undefined ? "" : `<p class="error-message" role="alert">${
        escapeAttribute(input.error.message)
      }</p>${renderErrorSummary(errors)}`}
      <form method="post" action="${ADMIN_WEB_ROOT}/recovery/complete">
        <input type="hidden" name="_csrf" value="${escapeAttribute(input.csrfToken)}">
        ${textField({
          name: "token",
          label: "Recovery token",
          type: "password",
          autocomplete: "one-time-code",
          errors
        })}
        ${textField({
          name: "password",
          label: "Create password",
          type: "password",
          autocomplete: "new-password",
          help: "Use at least 12 characters.",
          errors
        })}
        <button type="submit">Complete recovery</button>
      </form>
      <p><a href="${ADMIN_WEB_ROOT}/sign-in">Return to sign in</a></p>
    </section>`
  });
}

function textField(input: {
  name: string;
  label: string;
  value?: string;
  type?: "text" | "password";
  autocomplete: string;
  help?: string;
  errors: readonly ErrorDetail[];
}): string {
  const id = fieldId(input.name);
  const descriptionIds = [
    input.help === undefined ? undefined : `${id}-help`,
    input.errors.some((error) => error.path === input.name)
      ? `${id}-errors`
      : undefined
  ].filter((value): value is string => value !== undefined);
  const describedBy = descriptionIds.length === 0
    ? ""
    : ` aria-describedby="${descriptionIds.join(" ")}"`;
  const invalid = input.errors.some((error) => error.path === input.name)
    ? " aria-invalid=\"true\""
    : "";
  return `<div class="field">
    <label for="${id}">${input.label}</label>
    ${input.help === undefined ? "" : `<p id="${id}-help" class="help">${input.help}</p>`}
    <input id="${id}" name="${input.name}" type="${input.type ?? "text"}"
      value="${escapeAttribute(input.value ?? "")}" autocomplete="${input.autocomplete}"
      required${describedBy}${invalid}>
    ${fieldError(input.errors, input.name)}
  </div>`;
}
