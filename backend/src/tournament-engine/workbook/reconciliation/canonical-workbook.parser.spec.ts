import { Workbook } from "exceljs";

import { parseStableUuid } from "../../domain";
import { CanonicalWorkbookParser } from "./canonical-workbook.parser";
import {
  copyBlankWorksheet,
  createSanitizedMultiPlayerWorkbookFixture,
  createSanitizedWorkbookFixture,
  matchWorksheet,
  mutateWorkbook
} from "./fixtures/sanitized-workbook.fixture";
import { createWorkbookReconciliationPreview } from "./workbook-reconciliation.preview";

describe("canonical workbook parser and preview", () => {
  const parser = new CanonicalWorkbookParser();

  it("reads safe identity before trusted generation lookup and treats beginning state as a no-op", async () => {
    const fixture = await createSanitizedWorkbookFixture();
    const identity = await parser.readIdentity(fixture.buffer);
    expect(identity).toMatchObject({
      tournamentId: fixture.scope.tournamentId,
      generationId: fixture.scope.generation.generationId,
      generationRevision: 1
    });

    const preview = await parseAndPreview(fixture.buffer, fixture.scope);
    expect(preview.issues).toEqual([]);
    expect(preview.observations.filter((item) => item.decision === "proposed"))
      .toHaveLength(0);
    expect(preview.observations.filter((item) => item.decision === "unchanged"))
      .toHaveLength(3);
  });

  it("proposes only semantic live changes across rename, reorder, style, and re-save churn", async () => {
    const fixture = await createSanitizedWorkbookFixture();
    const changed = await mutateWorkbook(fixture.buffer, (workbook) => {
      const first = matchWorksheet(workbook, fixture.matchIds[0]);
      first.name = "Renamed without identity effect";
      first.getCell("B2").value = "LIVE GAME";
      first.getCell("D10").value = "x";
      first.getCell("D10").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF123456" }
      };
      const second = matchWorksheet(workbook, fixture.matchIds[1]);
      const copy = copyWorksheet(workbook, second, "Reordered second game");
      workbook.removeWorksheet(second.id);
      copy.name = "Reordered second game";
    });
    const preview = await parseAndPreview(changed, fixture.scope);
    const proposed = preview.observations.filter((item) => item.decision === "proposed");
    expect(proposed).toHaveLength(1);
    expect(proposed[0].matchId).toBe(fixture.matchIds[0]);
    expect(proposed[0].candidate).toMatchObject({
      sourceRevisionNumber: 1,
      proposedStatus: "in_progress",
      proposedScoreAvailability: "partial",
      reason: "initial"
    });
    expect(proposed[0].candidate?.rawRows[0]).toMatchObject({
      teamId: fixture.scope.matches[0].teamIds[0],
      playerId: fixture.scope.matches[0].participants[0].playerId,
      rosterMembershipId:
        fixture.scope.matches[0].participants[0].rosterMembershipId,
      rosterSlot: 1
    });
    expect(preview.observations.find((item) => item.matchId === fixture.matchIds[1])?.decision)
      .toBe("unchanged");

    const resaved = await mutateWorkbook(changed, () => undefined);
    const repeated = await parseAndPreview(resaved, fixture.scope);
    expect(repeated.observations.filter((item) => item.decision === "proposed")[0]
      .candidate?.fingerprint).toBe(proposed[0].candidate?.fingerprint);
  });

  it("reports missing scorecards as non-destructive and imports other end-state finals", async () => {
    const fixture = await createSanitizedWorkbookFixture();
    const changed = await mutateWorkbook(fixture.buffer, (workbook) => {
      const missing = matchWorksheet(workbook, fixture.matchIds[0]);
      workbook.removeWorksheet(missing.id);
      const final = matchWorksheet(workbook, fixture.matchIds[1]);
      final.getCell("B2").value = "FINAL";
      final.getCell("N10").value = true;
    });
    const preview = await parseAndPreview(changed, fixture.scope);
    expect(preview.observations.find((item) => item.matchId === fixture.matchIds[0]))
      .toMatchObject({ decision: "missing_non_destructive" });
    expect(preview.observations.find((item) => item.matchId === fixture.matchIds[1]))
      .toMatchObject({
        decision: "proposed",
        candidate: {
          proposedStatus: "final",
          proposedScoreAvailability: "complete"
        }
      });
  });

  it("requires an explicit stable assignment for copied blanks", async () => {
    const fixture = await createSanitizedWorkbookFixture();
    const copied = await mutateWorkbook(fixture.buffer, (workbook) => {
      const originalGame = matchWorksheet(workbook, fixture.matchIds[0]);
      workbook.removeWorksheet(originalGame.id);
      const blank = copyBlankWorksheet(workbook, "Operator copy");
      blank.getCell("B2").value = "LIVE GAME";
      blank.getCell("D10").value = "x";
    });
    const parsed = await parser.parse({ buffer: copied, scope: fixture.scope });
    const copy = parsed.scorecards.find((sheet) => sheet.worksheetName === "Operator copy");
    expect(copy).toBeDefined();
    const unresolved = createWorkbookReconciliationPreview({ parsed, scope: fixture.scope });
    expect(unresolved.observations.find((item) => item.worksheetName === "Operator copy"))
      .toMatchObject({ decision: "unresolved" });

    const assigned = createWorkbookReconciliationPreview({
      parsed,
      scope: fixture.scope,
      assignments: [{
        worksheetIndex: copy!.worksheetIndex,
        matchId: fixture.matchIds[0]
      }]
    });
    expect(assigned.observations.find((item) => item.worksheetName === "Operator copy"))
      .toMatchObject({
        decision: "proposed",
        binding: "explicit_blank_assignment",
        matchId: fixture.matchIds[0]
      });
  });

  it("rejects copied blanks carrying embedded match or participant identity", async () => {
    const fixture = await createSanitizedWorkbookFixture();
    const tampered = await mutateWorkbook(fixture.buffer, (workbook) => {
      const game = matchWorksheet(workbook, fixture.matchIds[0]);
      const blank = copyBlankWorksheet(workbook, "Tampered blank");
      blank.getCell("W10").value = game.getCell("W10").value;
      blank.getCell("W14").value = game.getCell("W14").value;
      blank.getCell("W15").value = game.getCell("W15").value;
      for (let column = 24; column <= 27; column += 1) {
        blank.getCell(1, column).value = game.getCell(1, column).value;
      }
    });
    const parsed = await parser.parse({ buffer: tampered, scope: fixture.scope });
    const sheet = parsed.scorecards.find((item) => item.worksheetName === "Tampered blank")!;
    const preview = createWorkbookReconciliationPreview({
      parsed,
      scope: fixture.scope,
      assignments: [{ worksheetIndex: sheet.worksheetIndex, matchId: fixture.matchIds[1] }]
    });
    expect(preview.observations.find((item) => item.worksheetIndex === sheet.worksheetIndex))
      .toMatchObject({ decision: "invalid" });
    expect(sheet.issues.map((issue) => issue.code))
      .toContain("SCORECARD_BLANK_METADATA_INVALID");
  });

  it("rejects ambiguous blanks, explicit conflicts, formulas, scheduled input, and tampered identities", async () => {
    const fixture = await createSanitizedWorkbookFixture();
    const ambiguous = await mutateWorkbook(fixture.buffer, (workbook) => {
      copyBlankWorksheet(workbook, "Ambiguous copy");
    });
    const ambiguousPreview = await parseAndPreview(ambiguous, fixture.scope);
    expect(ambiguousPreview.observations.filter((item) => item.decision === "unresolved"))
      .toHaveLength(2);

    const invalid = await mutateWorkbook(fixture.buffer, (workbook) => {
      const sheet = matchWorksheet(workbook, fixture.matchIds[0]);
      sheet.getCell("D10").value = { formula: "=1", result: 1 };
      sheet.getCell("E11").value = true;
      sheet.getCell("W14").value = parseStableUuid(
        "00000000-0000-4000-8000-000000009999",
        "tournament_team"
      );
    });
    const parsed = await parser.parse({ buffer: invalid, scope: fixture.scope });
    const preview = createWorkbookReconciliationPreview({
      parsed,
      scope: fixture.scope,
      assignments: [{
        worksheetIndex: parsed.scorecards.find((sheet) =>
          sheet.matchId === fixture.matchIds[1]
        )!.worksheetIndex,
        matchId: fixture.matchIds[0]
      }]
    });
    expect(preview.observations.flatMap((item) => item.issues.map((issue) => issue.code)))
      .toEqual(expect.arrayContaining([
        "FORMULA_NOT_ALLOWED_IN_INPUT",
        "SCHEDULED_SCORECARD_HAS_INPUT",
        "SCORECARD_STABLE_METADATA_CONFLICT",
        "EXPLICIT_ASSIGNMENT_CONFLICTS_WITH_EMBEDDED_ID"
      ]));
  });

  it("freezes participant identity independently of visible shooter text", async () => {
    const fixture = await createSanitizedWorkbookFixture();
    const displayOnly = await mutateWorkbook(fixture.buffer, (workbook) => {
      const sheet = matchWorksheet(workbook, fixture.matchIds[0]);
      sheet.getCell("B2").value = "LIVE GAME";
      sheet.getCell("D10").value = "x";
      sheet.getCell("C10").value = "A misleading display name";
    });
    const displayPreview = await parseAndPreview(displayOnly, fixture.scope);
    const candidate = displayPreview.observations.find((item) =>
      item.matchId === fixture.matchIds[0]
    )?.candidate;
    expect(candidate?.rawRows[0].playerId)
      .toBe(fixture.scope.matches[0].participants[0].playerId);
    expect(displayPreview.observations.flatMap((item) => item.issues.map((issue) => issue.code)))
      .toContain("SCORECARD_SHOOTER_DISPLAY_MISMATCH");

    const tamperedParticipant = await mutateWorkbook(fixture.buffer, (workbook) => {
      const sheet = matchWorksheet(workbook, fixture.matchIds[0]);
      sheet.getCell("Z1").value = "00000000-0000-4000-8000-000000008888";
    });
    const tamperedPreview = await parseAndPreview(tamperedParticipant, fixture.scope);
    expect(tamperedPreview.observations.find((item) => item.matchId === fixture.matchIds[0]))
      .toMatchObject({ decision: "invalid" });
  });

  it("rejects an uploaded manifest that diverges from the trusted generation", async () => {
    const fixture = await createSanitizedWorkbookFixture();
    const tampered = await mutateWorkbook(fixture.buffer, (workbook) => {
      const metadata = workbook.getWorksheet("__Ruski Metadata");
      if (metadata === undefined) {
        throw new Error("Sanitized metadata worksheet was not found.");
      }
      metadata.getCell("J12").value = "b".repeat(64);
    });
    const preview = await parseAndPreview(tampered, fixture.scope);
    expect(preview.applicable).toBe(false);
    expect(preview.issues.map((issue) => issue.code))
      .toContain("WORKBOOK_MANIFEST_SCOPE_MISMATCH");
  });

  it("maps up to eight-player scorecard ownership through stable roster slots", async () => {
    const fixture = await createSanitizedMultiPlayerWorkbookFixture();
    const changed = await mutateWorkbook(fixture.buffer, (workbook) => {
      const sheet = matchWorksheet(workbook, fixture.matchIds[0]);
      sheet.getCell("B2").value = "LIVE GAME";
      sheet.getCell("D12").value = "x";
    });
    const preview = await parseAndPreview(changed, fixture.scope);
    const candidate = preview.observations.find((item) =>
      item.matchId === fixture.matchIds[0]
    )?.candidate;
    const recorded = candidate?.rawRows.find((row) =>
      row.sideNumber === 1 && row.worksheetRow === 12
    );
    expect(recorded).toMatchObject({
      rosterSlot: 3,
      playerId: fixture.scope.matches[0].participants[2].playerId,
      rosterMembershipId:
        fixture.scope.matches[0].participants[2].rosterMembershipId
    });
    expect(candidate?.participants).toHaveLength(16);
  });
});

async function parseAndPreview(
  buffer: Buffer,
  scope: Awaited<ReturnType<typeof createSanitizedWorkbookFixture>>["scope"]
) {
  const parser = new CanonicalWorkbookParser();
  const parsed = await parser.parse({ buffer, scope });
  return createWorkbookReconciliationPreview({ parsed, scope });
}

function copyWorksheet(
  workbook: Workbook,
  source: ReturnType<typeof matchWorksheet>,
  name: string
) {
  const copy = workbook.addWorksheet(name);
  for (let row = 1; row <= 89; row += 1) {
    for (let column = 1; column <= 27; column += 1) {
      copy.getCell(row, column).value = source.getCell(row, column).value;
    }
  }
  return copy;
}
