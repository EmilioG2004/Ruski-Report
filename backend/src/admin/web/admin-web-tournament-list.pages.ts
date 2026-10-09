import { ErrorDetail } from "../../errors";
import {
  MAIN_TOURNAMENT_PRESET_ID
} from "../../tournament-engine/configuration";
import { AdministratorPrincipal } from "../security";
import { AdminTournamentSummaryResponse } from "../tournament-setup";
import { FlatForm } from "./admin-web.form";
import {
  escapeAttribute,
  escapeHtml,
  fieldError,
  fieldId,
  formatLifecycle,
  formatTimestamp,
  renderAdminPage,
  renderErrorSummary
} from "./admin-web.html";
import { ADMIN_WEB_ROOT, AdminWebPageError } from "./admin-web.types";

export function renderTournamentListPage(input: {
  principal: AdministratorPrincipal;
  csrfToken: string;
  tournaments: readonly AdminTournamentSummaryResponse[];
  published?: boolean;
}): string {
  const rows = input.tournaments.length === 0
    ? `<p>No tournaments have been created.</p>`
    : `<div class="grid">${input.tournaments.map((tournament) => `
      <article class="panel">
        <p><span class="status">${escapeHtml(formatLifecycle(tournament.lifecycle))}</span></p>
        <h2><a href="${ADMIN_WEB_ROOT}/tournaments/${escapeAttribute(tournament.id)}/setup">${escapeHtml(tournament.name)}</a></h2>
        <p>${tournament.year} · ${escapeHtml(formatLifecycle(tournament.visibility))}</p>
        <p class="meta">Updated ${formatTimestamp(tournament.updatedAt)}</p>
      </article>`).join("")}</div>`;
  return renderAdminPage({
    title: "Tournaments",
    principal: input.principal,
    csrfToken: input.csrfToken,
    content: `<div class="actions">
      <div><p class="eyebrow">Administrator home</p><h1>Tournaments</h1></div>
      <a class="button" href="${ADMIN_WEB_ROOT}/tournaments/new">Create tournament</a>
    </div>
    ${input.published ? `<p class="notice" role="status">Tournament setup published successfully.</p>` : ""}
    ${rows}`
  });
}

export function renderCreateTournamentPage(input: {
  principal: AdministratorPrincipal;
  csrfToken: string;
  values?: FlatForm;
  error?: AdminWebPageError;
}): string {
  const values = input.values ?? {};
  const errors = input.error?.details ?? [];
  const kind = values["configuration.kind"] ?? "preset";
  return renderAdminPage({
    title: "Create tournament",
    principal: input.principal,
    csrfToken: input.csrfToken,
    content: `<section class="panel">
      <p class="eyebrow">New tournament</p>
      <h1>Create tournament</h1>
      <p>The configuration is copied into the tournament and becomes immutable when setup is published.</p>
      ${input.error === undefined ? "" : `<p class="error-message" role="alert">${escapeHtml(input.error.message)}</p>${renderErrorSummary(errors)}`}
      <form method="post" action="${ADMIN_WEB_ROOT}/tournaments/new">
        <input type="hidden" name="_csrf" value="${escapeAttribute(input.csrfToken)}">
        ${inputField("name", "Tournament name", values.name ?? "", errors, "text")}
        ${inputField("year", "Calendar year", values.year ?? String(new Date().getUTCFullYear()), errors, "number")}
        <fieldset id="${fieldId("configuration")}">
          <legend>Format configuration</legend>
          <label><input type="radio" name="configuration.kind" value="preset"${kind === "preset" ? " checked" : ""}> Main tournament preset</label>
          <p class="help">${escapeHtml(MAIN_TOURNAMENT_PRESET_ID)}: 32 teams, eight pods, two players per team, 16-team playoff.</p>
          <label><input type="radio" name="configuration.kind" value="advanced"${kind === "advanced" ? " checked" : ""}> Advanced balanced configuration</label>
          ${fieldError(errors, "configuration")}
          <div class="grid">
            ${advancedNumber("teamCount", "Team count", "32", values, errors)}
            ${advancedNumber("podCount", "Pod count", "8", values, errors)}
            ${advancedNumber("podSize", "Teams per pod", "4", values, errors)}
            ${advancedNumber("playersPerTeam", "Players per team", "2", values, errors)}
            ${advancedNumber("gamesPerPair", "Games per pair", "1", values, errors)}
            ${advancedNumber("qualifiersPerPod", "Qualifiers per pod", "2", values, errors)}
            ${advancedNumber("bracketSize", "Bracket size", "16", values, errors)}
          </div>
          <label><input type="checkbox" name="configuration.value.allowByes" value="true"${
            values["configuration.value.allowByes"] === "true" ? " checked" : ""
          }> Allow byes when the bracket has open slots</label>
        </fieldset>
        <div class="actions"><button type="submit">Create draft</button><a class="button secondary" href="${ADMIN_WEB_ROOT}/tournaments">Cancel</a></div>
      </form>
    </section>`
  });
}

function inputField(
  name: string,
  label: string,
  value: string,
  errors: readonly ErrorDetail[],
  type: "text" | "number"
): string {
  return `<div class="field">
    <label for="${fieldId(name)}">${label}</label>
    <input id="${fieldId(name)}" name="${name}" type="${type}" value="${escapeAttribute(value)}" required>
    ${fieldError(errors, name)}
  </div>`;
}

function advancedNumber(
  field: string,
  label: string,
  fallback: string,
  values: FlatForm,
  errors: readonly ErrorDetail[]
): string {
  const name = `configuration.value.${field}`;
  return inputField(name, label, values[name] ?? fallback, errors, "number");
}
