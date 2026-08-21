import { AdministratorPrincipal } from "../security";
import { AdminTournamentDetailResponse } from "../tournament-setup";
import {
  escapeAttribute,
  escapeHtml,
  renderAdminPage
} from "../web/admin-web.html";
import { ADMIN_WEB_ROOT } from "../web/admin-web.types";
import {
  AdminTournamentWorkbookGenerationResponse,
  AdminTournamentWorkbookImportPreviewResponse,
  AdminTournamentWorkbookImportResultResponse
} from "./admin-tournament-workbook.contracts";

export function renderTournamentWorkbookPage(input: {
  principal: AdministratorPrincipal;
  csrfToken: string;
  detail: AdminTournamentDetailResponse;
  generations: readonly AdminTournamentWorkbookGenerationResponse[];
  notice?: string;
}): string {
  const tournamentId = escapeAttribute(input.detail.tournament.id);
  const root = `${ADMIN_WEB_ROOT}/tournaments/${tournamentId}/workbooks`;
  const available = input.detail.tournament.lifecycle !== "draft_setup";
  return renderAdminPage({
    title: `Workbook · ${input.detail.tournament.name}`,
    principal: input.principal,
    csrfToken: input.csrfToken,
    content: `<p><a href="${ADMIN_WEB_ROOT}/tournaments/${tournamentId}/setup">← Tournament setup</a></p>
    <section class="panel">
      <p class="eyebrow">Canonical workbook</p>
      <h1>${escapeHtml(input.detail.tournament.name)}</h1>
      ${input.notice === undefined ? "" : `<p class="notice" role="status">${escapeHtml(input.notice)}</p>`}
      ${available ? `<form method="post" action="${root}/generate">
        <input type="hidden" name="_csrf" value="${escapeAttribute(input.csrfToken)}">
        <input type="hidden" name="expectedTournamentRowVersion" value="${input.detail.tournament.rowVersion}">
        <p>Generate the cumulative scorekeeping workbook from the current canonical tournament setup.</p>
        <button type="submit">Generate workbook</button>
      </form>` : `<p>Publish setup before generating a workbook.</p>`}
      ${renderGenerations(input.generations)}
    </section>
    <section class="panel">
      <h2>Preview workbook updates</h2>
      <p>Upload a cumulative canonical workbook. Missing scorecards do not remove prior imports.</p>
      <form method="post" action="${root}/imports/preview" enctype="multipart/form-data">
        <input type="hidden" name="_csrf" value="${escapeAttribute(input.csrfToken)}">
        <div class="field"><label for="field-workbook">Workbook (.xlsx)</label>
          <input id="field-workbook" name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></div>
        <button type="submit"${available ? "" : " disabled"}>Preview import</button>
      </form>
    </section>`
  });
}

export function renderTournamentWorkbookPreviewPage(input: {
  principal: AdministratorPrincipal;
  csrfToken: string;
  detail: AdminTournamentDetailResponse;
  preview: AdminTournamentWorkbookImportPreviewResponse;
}): string {
  const tournamentId = escapeAttribute(input.detail.tournament.id);
  const root = `${ADMIN_WEB_ROOT}/tournaments/${tournamentId}/workbooks`;
  const proposals = input.preview.observations.filter(
    (observation) => observation.classification === "proposed"
  );
  const unresolved = input.preview.observations.filter(
    (observation) => observation.classification === "unresolved"
  );
  return renderAdminPage({
    title: `Workbook preview · ${input.detail.tournament.name}`,
    principal: input.principal,
    csrfToken: input.csrfToken,
    content: `<p><a href="${root}">← Workbook operations</a></p>
    <section class="panel">
      <p class="eyebrow">Import preview</p>
      <h1>${escapeHtml(input.detail.tournament.name)}</h1>
      <p>${input.preview.counts.proposed} proposed · ${input.preview.counts.unchanged} unchanged · ${input.preview.counts.missingNonDestructive} missing without deletion</p>
      ${renderPreviewIssues(input.preview)}
      ${renderObservationTable(input.preview)}
      ${input.preview.status === "assignment_required" && unresolved.length > 0
        ? renderAssignmentForm(root, input, unresolved)
        : ""}
      ${input.preview.status === "preview_ready" &&
          input.preview.previewDigest !== null
        ? renderApplyForm(root, input, proposals)
        : renderPreviewLifecycleNotice(input.preview.status)}
    </section>`
  });
}

export function renderTournamentWorkbookResultPage(input: {
  principal: AdministratorPrincipal;
  csrfToken: string;
  detail: AdminTournamentDetailResponse;
  result: AdminTournamentWorkbookImportResultResponse;
}): string {
  const root = `${ADMIN_WEB_ROOT}/tournaments/${escapeAttribute(input.detail.tournament.id)}/workbooks`;
  return renderAdminPage({
    title: `Workbook applied · ${input.detail.tournament.name}`,
    principal: input.principal,
    csrfToken: input.csrfToken,
    content: `<p><a href="${root}">← Workbook operations</a></p>
    <section class="panel"><p class="eyebrow">${escapeHtml(input.result.status)}</p>
      <h1>Workbook reconciliation complete</h1>
      <p>${input.result.acceptedCount} accepted · ${input.result.skippedCount} skipped · ${input.result.unchangedCount} unchanged · ${input.result.missingNonDestructiveCount} missing without deletion</p>
      <p>${input.result.materializedRevisions.length} canonical match revision${input.result.materializedRevisions.length === 1 ? "" : "s"} materialized · ${input.result.tournamentStatisticRunId === null ? "no tournament statistic run" : "tournament statistics materialized"}</p>
    </section>`
  });
}

function renderGenerations(
  generations: readonly AdminTournamentWorkbookGenerationResponse[]
): string {
  if (generations.length === 0) {
    return `<p>No canonical workbook has been generated yet.</p>`;
  }
  return `<h2>Generated workbooks</h2><ul>${generations.map((generation) =>
    `<li>Revision ${generation.revision} · ${generation.sizeBytes.toLocaleString("en-US")} bytes · <a href="${escapeAttribute(generation.downloadUrl)}">Download ${escapeHtml(generation.filename)}</a></li>`
  ).join("")}</ul>`;
}

function renderPreviewIssues(
  preview: AdminTournamentWorkbookImportPreviewResponse
): string {
  const issues = [
    ...preview.issues,
    ...preview.observations.flatMap((observation) => observation.issues)
  ];
  return issues.length === 0 ? "" : `<div class="error-summary"><h2>Warnings and errors</h2><ul>${issues.map((issue) =>
    `<li><strong>${escapeHtml(issue.severity)}</strong>: ${escapeHtml(issue.message)}</li>`
  ).join("")}</ul></div>`;
}

function renderObservationTable(
  preview: AdminTournamentWorkbookImportPreviewResponse
): string {
  return `<div class="table-scroll"><table><caption>Recognized scorecards</caption>
    <thead><tr><th>Sheet</th><th>Match</th><th>Decision</th><th>Status</th><th>Scoring impact</th></tr></thead>
    <tbody>${preview.observations.map((observation) => `<tr>
      <td>${escapeHtml(observation.label)}</td>
      <td>${escapeHtml(observation.matchLabel ?? observation.matchId ?? "Assignment required")}</td>
      <td>${escapeHtml(observation.classification)}</td>
      <td>${escapeHtml(observation.proposedStatus ?? "No change")}</td>
      <td>${renderScoringImpact(observation)}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

function renderScoringImpact(
  observation: AdminTournamentWorkbookImportPreviewResponse["observations"][number]
): string {
  const current = observation.currentImpact === null
    ? null
    : scoreLine(observation.currentImpact.teams);
  const proposed = observation.proposedImpact === null
    ? null
    : scoreLine(observation.proposedImpact.teams);
  if (proposed === null) {
    return escapeHtml(current === null ? "No scoring change" : `Current ${current}`);
  }
  const totals = observation.proposedImpact?.matchTotals;
  const statisticImpact = totals === undefined
    ? ""
    : ` · ${totals.makes}/${totals.attempts} shots · ${totals.cupsScored} cups`;
  const winnerSide = observation.proposedImpact?.teams.find((team) =>
    team.teamId === observation.proposedImpact?.winnerTeamId
  )?.sideNumber;
  const winnerImpact = winnerSide === undefined
    ? " · winner pending"
    : ` · winner side ${winnerSide}`;
  const comparison = current === null
    ? `Proposed ${proposed}`
    : `Current ${current} → proposed ${proposed}`;
  return escapeHtml(`${comparison}${statisticImpact}${winnerImpact}`);
}

function scoreLine(
  teams: readonly { sideNumber: 1 | 2; score: number | null }[]
): string {
  return [...teams]
    .sort((left, right) => left.sideNumber - right.sideNumber)
    .map((team) => team.score === null ? "unavailable" : String(team.score))
    .join("–");
}

function renderAssignmentForm(
  root: string,
  input: {
    csrfToken: string;
    preview: AdminTournamentWorkbookImportPreviewResponse;
  },
  unresolved: AdminTournamentWorkbookImportPreviewResponse["observations"]
): string {
  return `<form method="post" action="${root}/imports/${escapeAttribute(input.preview.id)}/assignments">
    <input type="hidden" name="_csrf" value="${escapeAttribute(input.csrfToken)}">
    <input type="hidden" name="expectedPreviewDigest" value="${escapeAttribute(input.preview.previewDigest ?? "")}">
    <h2>Assign copied blank scorecards</h2>
    ${unresolved.map((observation) => `<div class="field"><label for="assignment-${escapeAttribute(observation.id)}">${escapeHtml(observation.label)}</label>
      <select id="assignment-${escapeAttribute(observation.id)}" name="assignments.${escapeAttribute(observation.id)}" required>
        <option value="">Choose an unresolved match</option>${input.preview.assignableMatches.map((match) =>
          `<option value="${escapeAttribute(match.id)}">${escapeHtml(match.label)}</option>`
        ).join("")}</select></div>`).join("")}
    <button type="submit">Update preview</button>
  </form>`;
}

function renderApplyForm(
  root: string,
  input: {
    csrfToken: string;
    preview: AdminTournamentWorkbookImportPreviewResponse;
  },
  proposals: AdminTournamentWorkbookImportPreviewResponse["observations"]
): string {
  return `<form method="post" action="${root}/imports/${escapeAttribute(input.preview.id)}/apply">
    <input type="hidden" name="_csrf" value="${escapeAttribute(input.csrfToken)}">
    <input type="hidden" name="previewDigest" value="${escapeAttribute(input.preview.previewDigest ?? "")}">
    <h2>${proposals.length === 0
      ? "Confirm unchanged workbook"
      : "Confirm selected revisions"}</h2>
    ${proposals.map((observation) => `<fieldset><legend>${escapeHtml(observation.matchLabel ?? observation.label)}</legend>
      <label><input type="checkbox" name="acceptedObservationIds" value="${escapeAttribute(observation.id)}" checked> Apply this scorecard</label>
      ${observation.correction ? `<div class="field"><label for="reason-${escapeAttribute(observation.id)}">Correction reason</label>
        <input id="reason-${escapeAttribute(observation.id)}" name="correctionReasons.${escapeAttribute(observation.id)}" maxlength="500" required></div>` : ""}
    </fieldset>`).join("")}
    <p class="notice">${proposals.length === 0
      ? "This identical import changes no match source state and records an audited no-op."
      : "Every unselected proposed sheet is recorded as skipped. The selected subset applies atomically."}</p>
    <button type="submit">${proposals.length === 0
      ? "Record no-op import"
      : "Apply selected revisions"}</button>
  </form>`;
}

function renderPreviewLifecycleNotice(
  status: AdminTournamentWorkbookImportPreviewResponse["status"]
): string {
  switch (status) {
    case "assignment_required":
      return `<p class="notice">Resolve every copied blank scorecard before applying.</p>`;
    case "preview_rejected":
      return `<p class="notice">This workbook cannot be applied until its validation errors are corrected.</p>`;
    case "expired":
      return `<p class="notice">This preview expired. Upload the workbook again for a fresh comparison.</p>`;
    case "applied":
    case "no_op":
      return `<p class="notice">This preview has already been confirmed.</p>`;
    case "preview_ready":
      return "";
  }
}
