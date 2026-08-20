import { ErrorDetail } from "../../errors";
import { AdministratorPrincipal } from "../security";
import {
  AdminTournamentDetailResponse,
  AdminTournamentSetupPreviewResponse
} from "../tournament-setup";
import { FlatForm } from "./admin-web.form";
import {
  escapeAttribute,
  escapeHtml,
  fieldError,
  fieldId,
  formatLifecycle,
  renderAdminPage,
  renderErrorSummary
} from "./admin-web.html";
import { ADMIN_WEB_ROOT, AdminWebPageError } from "./admin-web.types";

export function renderTournamentSetupPage(input: {
  principal: AdministratorPrincipal;
  csrfToken: string;
  detail: AdminTournamentDetailResponse;
  values?: FlatForm;
  error?: AdminWebPageError;
  saved?: boolean;
}): string {
  const { detail } = input;
  const errors = input.error?.details ?? detail.validation.issues;
  const locked = detail.tournament.lifecycle !== "draft_setup";
  return renderAdminPage({
    title: detail.tournament.name,
    principal: input.principal,
    csrfToken: input.csrfToken,
    content: `<p><a href="${ADMIN_WEB_ROOT}/tournaments">← All tournaments</a></p>
    <section class="panel${locked ? " locked" : ""}">
      <p class="eyebrow">${escapeHtml(formatLifecycle(detail.tournament.lifecycle))} · ${escapeHtml(formatLifecycle(detail.tournament.visibility))}</p>
      <h1>${escapeHtml(detail.tournament.name)}</h1>
      <p>${detail.tournament.year} · ${detail.configuration.teamCount} teams · ${detail.configuration.podCount} pods · ${detail.configuration.bracketSize}-team bracket</p>
      ${input.saved ? `<p class="notice" role="status">Draft setup saved.</p>` : ""}
      ${input.error === undefined ? "" : `<p class="error-message" role="alert">${escapeHtml(input.error.message)}</p>`}
      ${renderErrorSummary(errors)}
      ${locked ? renderLockedSetup(detail) : renderEditableSetup(detail, input.csrfToken, input.values, errors)}
    </section>
    <section class="panel locked">
      <h2>Canonical workbook</h2>
      ${locked
        ? `<p>Generate the canonical scorekeeping workbook, preview cumulative updates, and apply selected revisions without deleting omitted scorecards.</p>
          <p><a class="button secondary" href="${ADMIN_WEB_ROOT}/tournaments/${escapeAttribute(detail.tournament.id)}/workbooks">Open workbook operations</a></p>`
        : `<p>Publish setup before generating or reconciling the canonical workbook.</p>`}
    </section>`
  });
}

function renderEditableSetup(
  detail: AdminTournamentDetailResponse,
  csrfToken: string,
  values: FlatForm | undefined,
  errors: readonly ErrorDetail[]
): string {
  const teams = setupTeamSlots(detail, values);
  return `<form method="post" action="${ADMIN_WEB_ROOT}/tournaments/${escapeAttribute(detail.tournament.id)}/setup">
    <input type="hidden" name="_csrf" value="${escapeAttribute(csrfToken)}">
    <input type="hidden" name="expectedRowVersion" value="${detail.tournament.rowVersion}">
    <h2 id="${fieldId("pods")}">Pods</h2>
    <div class="grid">${detail.pods.map((pod, index) => {
      const idName = `pods.${index}.id`;
      const nameName = `pods.${index}.name`;
      return `<fieldset><legend>Pod ${pod.sequence}</legend>
        <input type="hidden" name="${idName}" value="${escapeAttribute(pod.id)}">
        ${namedInput(nameName, "Pod name", values?.[nameName] ?? pod.name, errors)}
      </fieldset>`;
    }).join("")}</div>
    <h2 id="${fieldId("teams")}">Teams and players</h2>
    ${teams.map((team, teamIndex) => renderTeam(detail, team, teamIndex, errors)).join("")}
    <div class="actions">
      <button type="submit">Save draft setup</button>
      <a class="button secondary" href="${ADMIN_WEB_ROOT}/tournaments/${escapeAttribute(detail.tournament.id)}/setup/preview">Review validation and schedule</a>
    </div>
  </form>`;
}

interface TeamSlot {
  id: string;
  name: string;
  podId: string;
  initialSeed: string;
  players: Array<{
    id: string;
    displayName: string;
    firstName: string;
    lastName: string;
    preferredName: string;
  }>;
}

function setupTeamSlots(
  detail: AdminTournamentDetailResponse,
  values?: FlatForm
): TeamSlot[] {
  const existing = [...detail.teams].sort((a, b) => a.sequence - b.sequence);
  return Array.from({ length: detail.configuration.teamCount }, (_, index) => {
    const team = existing[index];
    const defaults = defaultPodAndSeed(detail, index);
    const prefix = `teams.${index}`;
    return {
      id: values?.[`${prefix}.id`] ?? team?.id ?? "",
      name: values?.[`${prefix}.name`] ?? team?.name ?? "",
      podId: values?.[`${prefix}.podId`] ?? team?.podId ?? defaults.podId,
      initialSeed: values?.[`${prefix}.initialSeed`] ?? String(team?.initialSeed ?? defaults.seed),
      players: Array.from({ length: detail.configuration.playersPerTeam }, (_, playerIndex) => {
        const player = team?.players[playerIndex];
        const playerPrefix = `${prefix}.players.${playerIndex}`;
        return {
          id: values?.[`${playerPrefix}.id`] ?? player?.id ?? "",
          displayName: values?.[`${playerPrefix}.displayName`] ?? player?.displayName ?? "",
          firstName: values?.[`${playerPrefix}.firstName`] ?? player?.firstName ?? "",
          lastName: values?.[`${playerPrefix}.lastName`] ?? player?.lastName ?? "",
          preferredName: values?.[`${playerPrefix}.preferredName`] ?? player?.preferredName ?? ""
        };
      })
    };
  });
}

function defaultPodAndSeed(
  detail: AdminTournamentDetailResponse,
  teamIndex: number
): { podId: string; seed: number } {
  let offset = 0;
  for (const pod of [...detail.pods].sort((a, b) => a.sequence - b.sequence)) {
    const size = detail.configuration.podSizes[pod.sequence - 1] ?? 0;
    if (teamIndex < offset + size) {
      return { podId: pod.id, seed: teamIndex - offset + 1 };
    }
    offset += size;
  }
  return { podId: detail.pods[0]?.id ?? "", seed: 1 };
}

function renderTeam(
  detail: AdminTournamentDetailResponse,
  team: TeamSlot,
  teamIndex: number,
  errors: readonly ErrorDetail[]
): string {
  const prefix = `teams.${teamIndex}`;
  return `<fieldset class="team-card" id="${fieldId(prefix)}">
    <legend>Team ${teamIndex + 1}</legend>
    <input type="hidden" name="${prefix}.id" value="${escapeAttribute(team.id)}">
    <div class="grid">
      ${namedInput(`${prefix}.name`, "Team name", team.name, errors, false)}
      <div class="field"><label for="${fieldId(`${prefix}.podId`)}">Pod</label>
        <select id="${fieldId(`${prefix}.podId`)}" name="${prefix}.podId" required>${[...detail.pods]
          .sort((a, b) => a.sequence - b.sequence)
          .map((pod) => `<option value="${escapeAttribute(pod.id)}"${pod.id === team.podId ? " selected" : ""}>${escapeHtml(pod.name)}</option>`).join("")}</select>
        ${fieldError(errors, `${prefix}.podId`)}</div>
      ${numberInput(`${prefix}.initialSeed`, "Initial pod seed", team.initialSeed, errors)}
    </div>
    <div class="player-grid">${team.players.map((player, playerIndex) => {
      const playerPrefix = `${prefix}.players.${playerIndex}`;
      return `<fieldset><legend>Player ${playerIndex + 1}</legend>
        <input type="hidden" name="${playerPrefix}.id" value="${escapeAttribute(player.id)}">
        ${namedInput(`${playerPrefix}.displayName`, "Display name", player.displayName, errors, false)}
        ${namedInput(`${playerPrefix}.firstName`, "First name (optional)", player.firstName, errors, false)}
        ${namedInput(`${playerPrefix}.lastName`, "Last name (optional)", player.lastName, errors, false)}
        ${namedInput(`${playerPrefix}.preferredName`, "Preferred name (optional)", player.preferredName, errors, false)}
      </fieldset>`;
    }).join("")}</div>
  </fieldset>`;
}

function namedInput(
  name: string,
  label: string,
  value: string,
  errors: readonly ErrorDetail[],
  required = true
): string {
  return `<div class="field"><label for="${fieldId(name)}">${label}</label>
    <input id="${fieldId(name)}" name="${name}" value="${escapeAttribute(value)}"${required ? " required" : ""}>
    ${fieldError(errors, name)}</div>`;
}

function numberInput(
  name: string,
  label: string,
  value: string,
  errors: readonly ErrorDetail[]
): string {
  return `<div class="field"><label for="${fieldId(name)}">${label}</label>
    <input id="${fieldId(name)}" name="${name}" type="number" min="1" value="${escapeAttribute(value)}" required>
    ${fieldError(errors, name)}</div>`;
}

function renderLockedSetup(detail: AdminTournamentDetailResponse): string {
  return `<p class="notice">Published setup is locked. Team names, pod assignments, initial seeds, and configuration cannot be changed.</p>
    <div class="grid">${[...detail.pods].sort((a, b) => a.sequence - b.sequence).map((pod) => `<section>
      <h2>${escapeHtml(pod.name)}</h2>
      <ol>${detail.teams.filter((team) => team.podId === pod.id)
        .sort((a, b) => a.initialSeed - b.initialSeed)
        .map((team) => `<li><strong>${escapeHtml(team.name)}</strong>: ${team.players.map((player) => escapeHtml(player.displayName)).join(", ")}</li>`).join("")}</ol>
    </section>`).join("")}</div>`;
}

export function renderSchedulePreviewPage(input: {
  principal: AdministratorPrincipal;
  csrfToken: string;
  detail: AdminTournamentDetailResponse;
  preview: AdminTournamentSetupPreviewResponse;
  error?: AdminWebPageError;
}): string {
  const setupUrl = `${ADMIN_WEB_ROOT}/tournaments/${escapeAttribute(input.detail.tournament.id)}/setup`;
  const issues = input.error?.details ?? input.preview.issues;
  const teamNames = new Map(input.detail.teams.map((team) => [team.id, team.name]));
  const podNames = new Map(input.detail.pods.map((pod) => [pod.id, pod.name]));
  return renderAdminPage({
    title: `Schedule preview · ${input.detail.tournament.name}`,
    principal: input.principal,
    csrfToken: input.csrfToken,
    content: `<p><a href="${setupUrl}">← Edit setup</a></p>
    <section class="panel">
      <p class="eyebrow">Publication review</p>
      <h1>Schedule preview</h1>
      <p>${escapeHtml(input.detail.tournament.name)} · ${input.preview.matchCount} pod-play matches</p>
      ${input.error === undefined ? "" : `<p class="error-message" role="alert">${escapeHtml(input.error.message)}</p>`}
      ${renderErrorSummary(issues, setupUrl)}
      ${input.preview.matches.length === 0 ? `<p>No matches can be generated until setup validates.</p>` : `
        <div class="table-scroll"><table><caption>Canonical pod-play schedule</caption>
          <thead><tr><th scope="col">Game</th><th scope="col">Pod</th><th scope="col">Participants</th><th scope="col">Schedule</th></tr></thead>
          <tbody>${input.preview.matches.map((match) => `<tr>
            <td>${match.sequence}</td><td>${escapeHtml(podNames.get(match.podId) ?? "Unknown pod")}</td>
            <td>${escapeHtml(teamNames.get(match.participantTeamIds[0]) ?? "Unknown team")} vs. ${escapeHtml(teamNames.get(match.participantTeamIds[1]) ?? "Unknown team")}</td>
            <td>${match.scheduledAt === null ? "Date and time not assigned" : escapeHtml(match.scheduledAt)}</td>
          </tr>`).join("")}</tbody></table></div>`}
      ${renderPublishForm(input)}
    </section>`
  });
}

function renderPublishForm(input: {
  csrfToken: string;
  detail: AdminTournamentDetailResponse;
  preview: AdminTournamentSetupPreviewResponse;
}): string {
  if (!input.preview.publishable || input.preview.previewDigest === null) {
    return `<p><a class="button secondary" href="${ADMIN_WEB_ROOT}/tournaments/${escapeAttribute(input.detail.tournament.id)}/setup">Correct setup</a></p>`;
  }
  return `<form method="post" action="${ADMIN_WEB_ROOT}/tournaments/${escapeAttribute(input.detail.tournament.id)}/setup/publish">
    <input type="hidden" name="_csrf" value="${escapeAttribute(input.csrfToken)}">
    <input type="hidden" name="expectedRowVersion" value="${input.preview.rowVersion}">
    <input type="hidden" name="previewDigest" value="${escapeAttribute(input.preview.previewDigest)}">
    <fieldset><legend>Publication visibility</legend>
      <label><input type="radio" name="visibility" value="private" checked> Keep private</label>
      <label><input type="radio" name="visibility" value="public"> Make public</label>
      <p class="help">Public marks the intended visibility. Discovery begins only after an eligible coherent public projection is activated in a later phase.</p>
    </fieldset>
    <div class="notice"><strong>Publication locks setup.</strong> Confirm the configuration, names, pod assignments, seeds, and schedule before continuing.</div>
    <button type="submit">Publish tournament setup</button>
  </form>`;
}
