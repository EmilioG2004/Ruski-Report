import {
  OperatorMatchResolutionPreview,
  TournamentProgressionRecord
} from "../../../tournament-engine/persistence";
import { AdministratorPrincipal } from "../../security";
import {
  AdminBracketPreviewResponse,
  FinalizeAdminPodRequest,
  OverrideAdminSeedOrderRequest,
  PreviewAdminMatchResolutionRequest,
  ResolveAdminGlobalSeedTieRequest,
  ResolveAdminStandingTieRequest
} from "../../tournament-progression";
import {
  escapeAttribute,
  escapeHtml,
  formatLifecycle,
  renderAdminPage
} from "../admin-web.html";
import { ADMIN_WEB_ROOT } from "../admin-web.types";

interface PageContext {
  principal: AdministratorPrincipal;
  csrfToken: string;
  progression: TournamentProgressionRecord;
}

export function renderTournamentProgressionPage(input: PageContext & {
  notice?: string;
}): string {
  const tournamentId = escapeAttribute(input.progression.tournamentId);
  const root = `${ADMIN_WEB_ROOT}/tournaments/${tournamentId}/progression`;
  const teamNames = progressionTeamNames(input.progression);
  return renderAdminPage({
    title: "Tournament progression",
    principal: input.principal,
    csrfToken: input.csrfToken,
    content: `<p><a href="${ADMIN_WEB_ROOT}/tournaments/${tournamentId}/setup">← Tournament setup</a></p>
    <section class="panel">
      <p class="eyebrow">${escapeHtml(formatLifecycle(input.progression.lifecycle))} · row version ${input.progression.rowVersion}</p>
      <h1>Tournament progression</h1>
      ${input.notice === undefined
        ? ""
        : `<p class="notice" role="status">${escapeHtml(input.notice)}</p>`}
      <p>Standings, official tie decisions, effective seeds, and bracket state are read from canonical tournament records.</p>
    </section>
    ${renderOperatorControls(root, input, teamNames)}
    ${renderPods(root, input, teamNames)}
    ${renderSeeds(root, input, teamNames)}
    ${renderBracket(root, input, teamNames)}`
  });
}

export function renderMatchResolutionConfirmationPage(input: PageContext & {
  matchId: string;
  request: PreviewAdminMatchResolutionRequest;
  preview: OperatorMatchResolutionPreview & {
    cascadeImpact?: {
      confirmationDigest: string;
      actionCount: number;
      replacementCount: number;
      actions: readonly {
        bracketMatchId: string;
        action: string;
        previousMatchId: string | null;
        replacementMatchId: string | null;
      }[];
    };
  };
}): string {
  const root = progressionRoot(input.progression.tournamentId);
  const cascade = input.preview.cascadeImpact;
  return confirmationPage(input, "Match resolution preview", `
    <dl>
      <dt>Match</dt><dd>${escapeHtml(input.matchId)}</dd>
      <dt>Current status</dt><dd>${escapeHtml(input.preview.currentStatus)}</dd>
      <dt>Proposed status</dt><dd>${escapeHtml(input.preview.proposedStatus)}</dd>
      <dt>Dependent bracket matches</dt><dd>${input.preview.dependentBracketMatchIds.length}</dd>
    </dl>
    ${input.preview.requiresCascade ? `<p class="error-message" role="alert"><strong>Protected dependency.</strong> This result will preserve prior match history and replace ${cascade?.replacementCount ?? 0} started dependent match instance${cascade?.replacementCount === 1 ? "" : "s"} across ${cascade?.actionCount ?? 0} bracket action${cascade?.actionCount === 1 ? "" : "s"}.</p>
    ${cascade === undefined ? "" : `<ul>${cascade.actions.map((action) =>
      `<li>${escapeHtml(action.action)} · bracket ${escapeHtml(action.bracketMatchId)} · prior match ${escapeHtml(action.previousMatchId ?? "none")} · replacement ${escapeHtml(action.replacementMatchId ?? "pending")}</li>`
    ).join("")}</ul>`}` : ""}
    ${!input.preview.requiresCascade || cascade !== undefined ? `
      <form method="post" action="${root}/matches/${escapeAttribute(input.matchId)}/apply">
        ${csrf(input.csrfToken)}
        ${hidden("expectedTournamentRowVersion", input.request.expectedTournamentRowVersion)}
        ${hidden("expectedMatchRowVersion", input.request.expectedMatchRowVersion)}
        ${hidden("commandType", input.request.commandType)}
        ${input.request.winnerTeamId === undefined ? "" : hidden("winnerTeamId", input.request.winnerTeamId)}
        ${hidden("reason", input.request.reason)}
        ${hidden("confirmationDigest", input.preview.confirmationDigest)}
        ${cascade === undefined ? "" : hidden("cascadeConfirmationDigest", cascade.confirmationDigest)}
        <p class="notice">Confirming creates an audited immutable match revision and recalculates dependent canonical state.</p>
        <button type="submit">Confirm ${escapeHtml(input.request.commandType)}</button>
      </form>` : `<p class="error-message" role="alert">This dependency change cannot be applied until a complete cascade plan is available.</p>`}
  `);
}

export function renderPodTieConfirmationPage(input: PageContext & {
  podId: string;
  request: ResolveAdminStandingTieRequest;
  confirmationDigest: string;
}): string {
  const root = progressionRoot(input.progression.tournamentId);
  const names = progressionTeamNames(input.progression);
  const order = asStrings(input.request.orderedTeamIds);
  return confirmationPage(input, "Pod tie resolution preview", `
    ${orderedTeamList(order, names)}
    <p><strong>Reason:</strong> ${escapeHtml(input.request.reason)}</p>
    <form method="post" action="${root}/pods/${escapeAttribute(input.podId)}/ties">
      ${csrf(input.csrfToken)}
      ${hidden("expectedTournamentRowVersion", input.request.expectedTournamentRowVersion)}
      ${hidden("activeCalculationId", input.request.activeCalculationId)}
      ${hidden("tieGroupId", input.request.tieGroupId)}
      ${hidden("orderedTeamIds", order.join(","))}
      ${hidden("reason", input.request.reason)}
      ${hidden("confirmationDigest", input.confirmationDigest)}
      <button type="submit">Confirm official pod order</button>
    </form>`);
}

export function renderPodFinalizationConfirmationPage(input: PageContext & {
  podId: string;
  request: FinalizeAdminPodRequest;
  confirmationDigest: string;
}): string {
  const root = progressionRoot(input.progression.tournamentId);
  return confirmationPage(input, "Pod finalization preview", `
    <p>This freezes the active standing calculation as an immutable audit artifact.</p>
    <form method="post" action="${root}/pods/${escapeAttribute(input.podId)}/finalizations">
      ${csrf(input.csrfToken)}
      ${hidden("expectedTournamentRowVersion", input.request.expectedTournamentRowVersion)}
      ${hidden("calculationId", input.request.calculationId)}
      ${hidden("reason", input.request.reason ?? "")}
      ${hidden("confirmationDigest", input.confirmationDigest)}
      <button type="submit">Confirm pod finalization</button>
    </form>`);
}

export function renderGlobalSeedTieConfirmationPage(input: PageContext & {
  request: ResolveAdminGlobalSeedTieRequest;
  confirmationDigest: string;
}): string {
  const root = progressionRoot(input.progression.tournamentId);
  const names = progressionTeamNames(input.progression);
  const order = asStrings(input.request.orderedTeamIds);
  return confirmationPage(input, "Qualifier tie resolution preview", `
    ${orderedTeamList(order, names)}
    <p><strong>Reason:</strong> ${escapeHtml(input.request.reason)}</p>
    <form method="post" action="${root}/seeds/ties">
      ${csrf(input.csrfToken)}
      ${hidden("expectedTournamentRowVersion", input.request.expectedTournamentRowVersion)}
      ${hidden("activeReviewVersionId", input.request.activeReviewVersionId)}
      ${hidden("seedCalculationId", input.request.seedCalculationId)}
      ${hidden("tieGroupId", input.request.tieGroupId)}
      ${hidden("orderedTeamIds", order.join(","))}
      ${hidden("reason", input.request.reason)}
      ${hidden("confirmationDigest", input.confirmationDigest)}
      <button type="submit">Confirm qualifier order</button>
    </form>`);
}

export function renderSeedOverrideConfirmationPage(input: PageContext & {
  request: OverrideAdminSeedOrderRequest;
  confirmationDigest: string;
}): string {
  const root = progressionRoot(input.progression.tournamentId);
  const names = progressionTeamNames(input.progression);
  const order = asStrings(input.request.orderedTeamIds);
  return confirmationPage(input, "Effective seed override preview", `
    ${orderedTeamList(order, names)}
    <p><strong>Reason:</strong> ${escapeHtml(input.request.reason)}</p>
    <p class="notice">This full permutation replaces the effective order for this seed calculation only.</p>
    <form method="post" action="${root}/seeds/overrides">
      ${csrf(input.csrfToken)}
      ${hidden("expectedTournamentRowVersion", input.request.expectedTournamentRowVersion)}
      ${hidden("calculationId", input.request.calculationId)}
      ${hidden("orderedTeamIds", order.join(","))}
      ${hidden("reason", input.request.reason)}
      ${hidden("confirmationDigest", input.confirmationDigest)}
      <button type="submit">Confirm effective seed order</button>
    </form>`);
}

export function renderBracketConfirmationPage(input: PageContext & {
  preview: AdminBracketPreviewResponse;
}): string {
  const root = progressionRoot(input.progression.tournamentId);
  return confirmationPage(input, "Bracket publication preview", `
    <dl>
      <dt>Bracket size</dt><dd>${input.preview.bracketSize}</dd>
      <dt>Qualifiers</dt><dd>${input.preview.qualifierCount}</dd>
      <dt>Rounds</dt><dd>${input.preview.roundCount}</dd>
      <dt>Playable matches</dt><dd>${input.preview.playableMatchCount}</dd>
      <dt>Structural byes</dt><dd>${input.preview.byeCount}</dd>
    </dl>
    <p>Placement order: ${input.preview.placementOrder.map(escapeHtml).join(", ")}</p>
    <p class="notice">Publication persists the bracket and produces a fresh cumulative canonical workbook in one operation.</p>
    <form method="post" action="${root}/bracket">
      ${csrf(input.csrfToken)}
      ${hidden("expectedTournamentRowVersion", input.preview.tournamentRowVersion)}
      ${hidden("confirmationDigest", input.preview.confirmationDigest)}
      <button type="submit">Publish bracket and workbook</button>
    </form>`);
}

function renderOperatorControls(
  root: string,
  input: PageContext,
  teamNames: ReadonlyMap<string, string>
): string {
  return `<section class="panel">
    <h2>Operator match resolution</h2>
    <p>Use the stable match identity and current match row version. Preview is required before an audited forfeit, cancellation, or postponement.</p>
    <div class="grid">
      ${matchResolutionForm(root, input, "forfeit", teamNames)}
      ${matchResolutionForm(root, input, "cancel", teamNames)}
      ${matchResolutionForm(root, input, "postpone", teamNames)}
    </div>
  </section>`;
}

function matchResolutionForm(
  root: string,
  input: PageContext,
  command: "forfeit" | "cancel" | "postpone",
  teamNames: ReadonlyMap<string, string>
): string {
  return `<form method="post" action="${root}/matches/preview">
    ${csrf(input.csrfToken)}
    ${hidden("expectedTournamentRowVersion", input.progression.rowVersion)}
    ${hidden("commandType", command)}
    <h3>${escapeHtml(formatLifecycle(command))}</h3>
    ${textField("matchId", "Stable match ID")}
    ${numberField("expectedMatchRowVersion", "Current match row version")}
    ${command === "forfeit" ? `<div class="field"><label>Winning team
      <select name="winnerTeamId" required><option value="">Choose a winner</option>${[...teamNames]
        .map(([id, name]) => `<option value="${escapeAttribute(id)}">${escapeHtml(name)} · ${escapeHtml(id)}</option>`)
        .join("")}</select></label></div>` : ""}
    ${reasonField()}
    <button type="submit">Preview ${escapeHtml(command)}</button>
  </form>`;
}

function renderPods(
  root: string,
  input: PageContext,
  teamNames: ReadonlyMap<string, string>
): string {
  return `<section class="panel"><h2>Pod standings and finalization</h2>
    ${input.progression.pods.length === 0 ? "<p>No pod standings are active.</p>" : input.progression.pods
      .map((pod) => `<section class="team-card">
        <h3>${escapeHtml(pod.name)}</h3>
        <p>${pod.calculationStatus === undefined ? "Not calculated" : escapeHtml(formatLifecycle(pod.calculationStatus))}${pod.finalizedAt === undefined ? "" : " · finalized"}</p>
        ${standingTable(pod.rows)}
        ${pod.tieGroups.filter((tie) => !tie.resolved).map((tie) => `<form method="post" action="${root}/pods/${escapeAttribute(pod.podId)}/ties/preview">
          ${csrf(input.csrfToken)}
          ${hidden("expectedTournamentRowVersion", input.progression.rowVersion)}
          ${hidden("activeCalculationId", pod.activeCalculationId ?? "")}
          ${hidden("tieGroupId", tie.tieGroupId)}
          <div class="field"><label>Official tied-team order
            <textarea name="orderedTeamIds" rows="3" required>${escapeHtml(tie.teamIds.join(","))}</textarea></label>
            <p class="help">Enter each tied team ID once, best to worst: ${tie.teamIds.map((id) => escapeHtml(teamNames.get(id) ?? id)).join(", ")}.</p></div>
          ${reasonField()}
          <button type="submit">Preview pod tie decision</button>
        </form>`).join("")}
        ${pod.calculationStatus === "finalizable" && pod.activeCalculationId !== undefined && pod.activeFinalizationId === undefined ? `<form method="post" action="${root}/pods/${escapeAttribute(pod.podId)}/finalizations/preview">
          ${csrf(input.csrfToken)}
          ${hidden("expectedTournamentRowVersion", input.progression.rowVersion)}
          ${hidden("calculationId", pod.activeCalculationId)}
          ${reasonField(true)}
          <button type="submit">Preview pod finalization</button>
        </form>` : ""}
      </section>`).join("")}
  </section>`;
}

function renderSeeds(
  root: string,
  input: PageContext,
  teamNames: ReadonlyMap<string, string>
): string {
  const review = input.progression.activeGlobalSeedReview;
  return `<section class="panel"><h2>Qualifier seeds</h2>
    ${input.progression.effectiveSeeds.length === 0 ? "<p>No effective seeds are active.</p>" : `<ol>${[...input.progression.effectiveSeeds]
      .sort((left, right) => left.effectiveSeed - right.effectiveSeed)
      .map((row) => `<li>${escapeHtml(teamNames.get(row.teamId) ?? row.teamId)} · calculated ${row.calculatedSeed}${row.overrideId === undefined ? "" : " · overridden"}</li>`)
      .join("")}</ol>`}
    ${review === undefined ? "" : review.tieGroups.filter((tie) => !tie.resolved).map((tie) => `<form method="post" action="${root}/seeds/ties/preview">
      ${csrf(input.csrfToken)}
      ${hidden("expectedTournamentRowVersion", input.progression.rowVersion)}
      ${hidden("activeReviewVersionId", review.reviewVersionId)}
      ${hidden("seedCalculationId", review.seedCalculationId)}
      ${hidden("tieGroupId", tie.tieGroupId)}
      <div class="field"><label>Official qualifier order
        <textarea name="orderedTeamIds" rows="3" required>${escapeHtml(tie.teamIds.join(","))}</textarea></label></div>
      ${reasonField()}
      <button type="submit">Preview qualifier tie decision</button>
    </form>`).join("")}
    ${input.progression.activeSeedCalculationId === undefined ? "" : `<form method="post" action="${root}/seeds/overrides/preview">
      ${csrf(input.csrfToken)}
      ${hidden("expectedTournamentRowVersion", input.progression.rowVersion)}
      ${hidden("calculationId", input.progression.activeSeedCalculationId)}
      <div class="field"><label>Full effective seed permutation
        <textarea name="orderedTeamIds" rows="6" required>${escapeHtml([...input.progression.effectiveSeeds]
          .sort((left, right) => left.effectiveSeed - right.effectiveSeed)
          .map((row) => row.teamId).join(","))}</textarea></label>
        <p class="help">Include every qualifier exactly once, seed 1 first.</p></div>
      ${reasonField()}
      <button type="submit">Preview seed override</button>
    </form>`}
  </section>`;
}

function renderBracket(
  root: string,
  input: PageContext,
  teamNames: ReadonlyMap<string, string>
): string {
  const bracket = input.progression.activeBracket;
  if (bracket === undefined) {
    const available = input.progression.activeSeedCalculationId !== undefined &&
      input.progression.effectiveSeeds.length > 0;
    return `<section class="panel"><h2>Playoff bracket</h2>
      <p>${available ? "Preview the mirrored official placement before publication." : "Complete seed review before previewing the bracket."}</p>
      ${available ? `<form method="post" action="${root}/bracket/preview">
        ${csrf(input.csrfToken)}
        ${hidden("expectedTournamentRowVersion", input.progression.rowVersion)}
        <button type="submit">Preview bracket and cumulative workbook</button>
      </form>` : ""}
    </section>`;
  }
  return `<section class="panel"><h2>${escapeHtml(bracket.name)}</h2>
    <p>${escapeHtml(formatLifecycle(bracket.status))}</p>
    ${bracket.rounds.map((round) => `<section><h3>${escapeHtml(round.name)}</h3><ol>${round.matches.map((match) => `<li>
      ${[...match.slots].sort((left, right) => left.slotNumber - right.slotNumber).map((slot) => escapeHtml(slot.teamName ?? (slot.teamId === undefined ? formatLifecycle(slot.sourceType) : teamNames.get(slot.teamId) ?? slot.teamId))).join(" vs. ")}
      · ${escapeHtml(match.matchStatus ?? (match.playable ? "scheduled" : "structural"))}
    </li>`).join("")}</ol></section>`).join("")}
  </section>`;
}

function standingTable(
  rows: TournamentProgressionRecord["pods"][number]["rows"]
): string {
  return `<div class="table-scroll"><table><thead><tr><th>Rank</th><th>Team</th><th>Record</th><th>Cup diff</th><th>Shooting</th><th>Qualified</th></tr></thead>
    <tbody>${rows.map((row) => `<tr><td>${row.rank ?? "—"}</td><td>${escapeHtml(row.teamName)}</td><td>${row.wins}–${row.losses}</td><td>${row.cupDifferential}</td><td>${row.shootingPercentage === null ? "—" : escapeHtml(`${(row.shootingPercentage * 100).toFixed(2)}%`)}</td><td>${row.qualified ? "Yes" : "No"}</td></tr>`).join("")}</tbody></table></div>`;
}

function confirmationPage(
  input: PageContext,
  title: string,
  content: string
): string {
  return renderAdminPage({
    title,
    principal: input.principal,
    csrfToken: input.csrfToken,
    content: `<p><a href="${progressionRoot(input.progression.tournamentId)}">← Progression</a></p>
      <section class="panel"><p class="eyebrow">Confirmation required</p><h1>${escapeHtml(title)}</h1>${content}</section>`
  });
}

function progressionRoot(tournamentId: string): string {
  return `${ADMIN_WEB_ROOT}/tournaments/${escapeAttribute(tournamentId)}/progression`;
}

function progressionTeamNames(
  progression: TournamentProgressionRecord
): ReadonlyMap<string, string> {
  return new Map([
    ...progression.pods.flatMap((pod) => pod.rows.map((row) => [
      row.teamId,
      row.teamName
    ] as const)),
    ...(progression.activeBracket?.rounds.flatMap((round) =>
      round.matches.flatMap((match) => match.slots.flatMap((slot) =>
        slot.teamId === undefined || slot.teamName === undefined
          ? []
          : [[slot.teamId, slot.teamName] as const]
      ))
    ) ?? [])
  ]);
}

function orderedTeamList(
  teamIds: readonly string[],
  names: ReadonlyMap<string, string>
): string {
  return `<ol>${teamIds.map((id) => `<li>${escapeHtml(names.get(id) ?? id)}</li>`).join("")}</ol>`;
}

function csrf(value: string): string {
  return hidden("_csrf", value);
}

function hidden(name: string, value: unknown): string {
  return `<input type="hidden" name="${escapeAttribute(name)}" value="${escapeAttribute(value)}">`;
}

function textField(name: string, label: string): string {
  return `<div class="field"><label>${escapeHtml(label)} <input name="${escapeAttribute(name)}" required></label></div>`;
}

function numberField(name: string, label: string): string {
  return `<div class="field"><label>${escapeHtml(label)} <input name="${escapeAttribute(name)}" type="number" min="1" required></label></div>`;
}

function reasonField(optional = false): string {
  return `<div class="field"><label>Reason${optional ? " (optional)" : ""}
    <textarea name="reason" rows="3" maxlength="500"${optional ? "" : " required minlength=\"3\""}></textarea></label></div>`;
}

function asStrings(values: unknown): string[] {
  return Array.isArray(values) ? values.map(String) : [];
}
