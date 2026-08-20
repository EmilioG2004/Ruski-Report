import { AdministratorPrincipal } from "../security";
import { parseStableUuid } from "../../tournament-engine/domain";
import {
  AdminTournamentDetailResponse,
  AdminTournamentSetupPreviewResponse
} from "../tournament-setup";
import {
  renderInvitationAcceptancePage,
  renderRecoveryCompletionPage,
  renderSignInPage
} from "./admin-web-auth.pages";
import { escapeHtml, renderErrorSummary } from "./admin-web.html";
import { renderSchedulePreviewPage, renderTournamentSetupPage } from "./admin-web-setup.pages";
import { renderTournamentListPage } from "./admin-web-tournament-list.pages";

describe("administrator web rendering", () => {
  it("escapes malicious and long content without inline executable assets", () => {
    const malicious = `<script>alert("owned")</script>${"x".repeat(500)}`;
    const html = renderTournamentListPage({
      principal: PRINCIPAL,
      csrfToken: "csrf-token",
      tournaments: [{
        ...DETAIL.tournament,
        name: malicious
      }]
    });

    expect(html).toContain(escapeHtml(malicious));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<style>");
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).toContain("href=\"/api/admin/app/assets/admin.css\"");
  });

  it("renders labeled authentication controls and never reflects an invitation token", () => {
    const signIn = renderSignInPage({ csrfToken: "csrf" });
    expect(signIn).toContain("<label for=\"field-loginName\">Login name</label>");
    expect(signIn).toContain("autocomplete=\"current-password\"");

    const invitation = renderInvitationAcceptancePage({
      csrfToken: "csrf",
      error: {
        statusCode: 400,
        message: "Token rejected",
        details: [{ path: "token", message: "Token rejected" }]
      }
    });
    expect(invitation).toContain("name=\"token\"");
    expect(invitation).not.toContain("raw-secret-invitation");
    expect(invitation).toContain("href=\"#field-token\"");
  });

  it("renders recovery without placing its one-time token in HTML", () => {
    const recovery = renderRecoveryCompletionPage({
      csrfToken: "csrf",
      error: {
        statusCode: 400,
        message: "Recovery token rejected",
        details: [{ path: "token", message: "Recovery token rejected" }]
      }
    });
    expect(recovery).toContain("action=\"/api/admin/app/recovery/complete\"");
    expect(recovery).toContain("<label for=\"field-token\">Recovery token</label>");
    expect(recovery).not.toContain("raw-secret-recovery-token");
    expect(recovery).not.toMatch(/[?&]token=/);

    const signIn = renderSignInPage({
      csrfToken: "csrf",
      recoveryCompleted: true
    });
    expect(signIn).toContain("Password recovery completed");
    expect(signIn).not.toContain("token=");
  });

  it("renders setup labels, error anchors, escaped names, and Phase 3 workbook status", () => {
    const detail = {
      ...DETAIL,
      teams: [{
        id: TEAM_ID,
        name: `<img src=x onerror=alert(1)>`,
        sequence: 1,
        podId: POD_ID,
        initialSeed: 1,
        players: [{ id: PLAYER_ID, displayName: "A very long player name" }]
      }],
      validation: {
        publishable: false,
        issues: [{
          code: "INVALID_SETUP_TEAM_COUNT",
          path: "teams.0.name",
          message: "Team name is required."
        }]
      }
    } satisfies AdminTournamentDetailResponse;
    const html = renderTournamentSetupPage({
      principal: PRINCIPAL,
      csrfToken: "csrf",
      detail
    });

    expect(html).toContain("for=\"field-teams-0-name\"");
    expect(html).toContain("href=\"#field-teams-0-name\"");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("Workbook generation becomes available in Phase 3");
    expect(html).not.toContain("Download workbook");
  });

  it("renders an explicit unknown schedule and a server-owned publication digest", () => {
    const preview: AdminTournamentSetupPreviewResponse = {
      tournamentId: TOURNAMENT_ID,
      rowVersion: 1,
      publishable: true,
      issues: [],
      previewDigest: "a".repeat(64),
      matchCount: 1,
      matches: [{
        id: MATCH_ID,
        tournamentId: TOURNAMENT_ID,
        podId: POD_ID,
        stage: "pod_play",
        sequence: 1,
        sequenceInPod: 1,
        roundNumber: 1,
        gameNumberForPair: 1,
        participantTeamIds: [TEAM_ID, SECOND_TEAM_ID],
        status: "scheduled",
        scoreAvailability: "not_started",
        scheduledAt: null
      }]
    };
    const html = renderSchedulePreviewPage({
      principal: PRINCIPAL,
      csrfToken: "csrf",
      detail: {
        ...DETAIL,
        teams: [
          { id: TEAM_ID, name: "One", sequence: 1, podId: POD_ID, initialSeed: 1, players: [] },
          { id: SECOND_TEAM_ID, name: "Two", sequence: 2, podId: POD_ID, initialSeed: 2, players: [] }
        ]
      },
      preview
    });
    expect(html).toContain("Date and time not assigned");
    expect(html).toContain(`value=\"${"a".repeat(64)}\"`);
    expect(html).not.toContain("name=\"matches\"");
  });

  it("links validation messages to stable field targets", () => {
    expect(renderErrorSummary([{
      path: "teams.0.players.0.displayName",
      message: "Display name is required."
    }])).toContain("href=\"#field-teams-0-players-0-displayName\"");
  });
});

const TOURNAMENT_ID = parseStableUuid(
  "00000000-0000-4000-8000-000000000001",
  "tournament"
);
const POD_ID = parseStableUuid(
  "00000000-0000-4000-8000-000000000002",
  "pod"
);
const TEAM_ID = parseStableUuid(
  "00000000-0000-4000-8000-000000000003",
  "tournament_team"
);
const SECOND_TEAM_ID = parseStableUuid(
  "00000000-0000-4000-8000-000000000004",
  "tournament_team"
);
const PLAYER_ID = parseStableUuid(
  "00000000-0000-4000-8000-000000000005",
  "tournament_player"
);
const MATCH_ID = parseStableUuid(
  "00000000-0000-4000-8000-000000000006",
  "match"
);

const PRINCIPAL: AdministratorPrincipal = {
  administratorId: "admin-1",
  loginName: "operator",
  displayName: "Operator",
  sessionId: "session-1",
  authenticatedAt: "2027-01-01T00:00:00.000Z",
  expiresAt: "2027-01-01T12:00:00.000Z"
};

const DETAIL: AdminTournamentDetailResponse = {
  tournament: {
    id: TOURNAMENT_ID,
    publicKey: TOURNAMENT_ID,
    gameType: "ruski",
    year: 2027,
    name: "Tournament",
    lifecycle: "draft_setup",
    visibility: "private",
    rowVersion: 1,
    setupPublishedAt: null,
    createdAt: "2027-01-01T00:00:00.000Z",
    updatedAt: "2027-01-01T00:00:00.000Z"
  },
  configuration: {
    formatVersion: 1,
    formatType: "pod_and_single_elimination",
    teamCount: 1,
    podCount: 1,
    podSizes: [1],
    playersPerTeam: 1,
    gamesPerPair: 1,
    qualifiersPerPod: 1,
    bracketSize: 2,
    allowByes: true,
    standingsRules: ["record", "cupDifferential", "teamShootingPercentage", "administratorResolution"]
  },
  pods: [{ id: POD_ID, name: "Pod One", sequence: 1 }],
  teams: [],
  validation: { publishable: false, issues: [] }
};
