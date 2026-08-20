import { parseStableUuid } from "../../tournament-engine/domain";
import { createSmallTournamentConfiguration } from "../../tournament-engine/setup";
import { AdminTournamentDetailResponse } from "../tournament-setup";
import {
  renderTournamentWorkbookPage,
  renderTournamentWorkbookPreviewPage,
  renderTournamentWorkbookResultPage
} from "./admin-tournament-workbook.pages";

describe("administrator workbook pages", () => {
  it("renders native generation/upload controls without executable content", () => {
    const html = renderTournamentWorkbookPage({
      principal: PRINCIPAL,
      csrfToken: "csrf-token",
      detail: DETAIL,
      generations: [{
        id: uuid(80),
        tournamentId: DETAIL.tournament.id,
        revision: 1,
        schemaVersion: 1,
        sourceDigest: "a".repeat(64),
        artifactSha256: "b".repeat(64),
        sizeBytes: 1234,
        generatedAt: "2027-01-03T00:00:00.000Z",
        filename: "ruski-report-2027-sanitized.xlsx",
        downloadUrl: `/api/admin/tournaments/${DETAIL.tournament.id}/workbook-generations/${uuid(80)}/download`
      }]
    });
    expect(html).toContain("enctype=\"multipart/form-data\"");
    expect(html).toContain("name=\"_csrf\" value=\"csrf-token\"");
    expect(html).toContain("Generate workbook");
    expect(html).not.toContain("<script");
  });

  it("requires assignments before exposing apply controls", () => {
    const previewId = uuid(90);
    const proposedId = uuid(91);
    const unresolvedId = uuid(92);
    const html = renderTournamentWorkbookPreviewPage({
      principal: PRINCIPAL,
      csrfToken: "csrf-token",
      detail: DETAIL,
      preview: {
        id: previewId,
        tournamentId: DETAIL.tournament.id,
        sourceGenerationId: uuid(80),
        status: "assignment_required",
        previewDigest: "c".repeat(64),
        expiresAt: "2027-01-04T00:00:00.000Z",
        counts: {
          unchanged: 1,
          proposed: 1,
          invalid: 0,
          unresolved: 1,
          missingNonDestructive: 2
        },
        observations: [{
          id: proposedId,
          ordinal: 1,
          label: "Worksheet 1",
          classification: "proposed",
          matchId: uuid(30),
          matchLabel: "Sanitized Team 1 vs Sanitized Team 2",
          proposedStatus: "final",
          proposedScoreAvailability: "complete",
          correction: true,
          issues: []
        }, {
          id: unresolvedId,
          ordinal: 2,
          label: "Copied blank worksheet 2",
          classification: "unresolved",
          matchId: null,
          matchLabel: null,
          proposedStatus: null,
          proposedScoreAvailability: null,
          correction: false,
          issues: []
        }],
        assignableMatches: [{ id: uuid(31), label: "Match 31" }],
        issues: []
      }
    });
    expect(html).toContain(`assignments.${unresolvedId}`);
    expect(html).not.toContain(`correctionReasons.${proposedId}`);
    expect(html).not.toContain("Apply selected revisions");
    expect(html).toContain("missing without deletion");
    expect(html).not.toContain("<script");
  });

  it("renders correction confirmation and an explicit identical no-op path", () => {
    const correctionId = uuid(93);
    const correctionHtml = renderTournamentWorkbookPreviewPage({
      principal: PRINCIPAL,
      csrfToken: "csrf-token",
      detail: DETAIL,
      preview: previewResponse({
        status: "preview_ready",
        proposed: [{
          id: correctionId,
          ordinal: 1,
          label: "Game 1",
          classification: "proposed",
          matchId: uuid(30),
          matchLabel: "Sanitized Team 1 vs Sanitized Team 2",
          proposedStatus: "final",
          proposedScoreAvailability: "complete",
          correction: true,
          issues: []
        }]
      })
    });
    expect(correctionHtml).toContain(`correctionReasons.${correctionId}`);
    expect(correctionHtml).toContain("Apply selected revisions");

    const noOpHtml = renderTournamentWorkbookPreviewPage({
      principal: PRINCIPAL,
      csrfToken: "csrf-token",
      detail: DETAIL,
      preview: previewResponse({ status: "preview_ready", proposed: [] })
    });
    expect(noOpHtml).toContain("Record no-op import");
  });

  it("renders an applied result without workbook cell content", () => {
    const html = renderTournamentWorkbookResultPage({
      principal: PRINCIPAL,
      csrfToken: "csrf",
      detail: DETAIL,
      result: {
        id: uuid(90),
        tournamentId: DETAIL.tournament.id,
        status: "applied",
        acceptedCount: 2,
        skippedCount: 1,
        unchangedCount: 3,
        missingNonDestructiveCount: 4,
        appliedAt: "2027-01-03T00:00:00.000Z"
      }
    });
    expect(html).toContain("2 accepted · 1 skipped · 3 unchanged");
  });
});

const PRINCIPAL = {
  administratorId: uuid(1),
  loginName: "operator",
  displayName: "Operator",
  sessionId: uuid(2),
  authenticatedAt: "2027-01-01T00:00:00.000Z",
  expiresAt: "2027-01-02T00:00:00.000Z"
};

const DETAIL: AdminTournamentDetailResponse = {
  tournament: {
    id: parseStableUuid(uuid(10), "tournament"),
    publicKey: uuid(10),
    gameType: "ruski",
    year: 2027,
    name: "Sanitized Tournament",
    lifecycle: "setup_published",
    visibility: "private",
    rowVersion: 2,
    setupPublishedAt: "2027-01-02T00:00:00.000Z",
    createdAt: "2027-01-01T00:00:00.000Z",
    updatedAt: "2027-01-02T00:00:00.000Z"
  },
  configuration: createSmallTournamentConfiguration(),
  pods: [],
  teams: [],
  validation: { publishable: true, issues: [] }
};

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function previewResponse(input: {
  status: "preview_ready";
  proposed: Parameters<typeof renderTournamentWorkbookPreviewPage>[0]["preview"]["observations"];
}): Parameters<typeof renderTournamentWorkbookPreviewPage>[0]["preview"] {
  return {
    id: uuid(90),
    tournamentId: DETAIL.tournament.id,
    sourceGenerationId: uuid(80),
    status: input.status,
    previewDigest: "c".repeat(64),
    expiresAt: "2027-01-04T00:00:00.000Z",
    counts: {
      unchanged: input.proposed.length === 0 ? 2 : 0,
      proposed: input.proposed.length,
      invalid: 0,
      unresolved: 0,
      missingNonDestructive: 0
    },
    observations: input.proposed,
    assignableMatches: [],
    issues: []
  };
}
