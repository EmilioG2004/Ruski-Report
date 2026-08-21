import { WorkbookApplyPlanningError } from "./errors";
import { parseStableUuid } from "../../domain";
import {
  createSanitizedWorkbookFixture,
  matchWorksheet,
  mutateWorkbook
} from "./fixtures/sanitized-workbook.fixture";
import { CanonicalWorkbookParser } from "./canonical-workbook.parser";
import { createWorkbookParticipantDigest } from "./semantic-fingerprint";
import {
  CanonicalMatchReconciliationScope,
  CanonicalWorkbookScope,
  WorkbookMatchRevisionCandidate,
  WorkbookReconciliationPreview
} from "./types";
import { planWorkbookImportApply } from "./workbook-apply.planner";
import { createWorkbookReconciliationPreview } from "./workbook-reconciliation.preview";

describe("workbook apply planner", () => {
  it("plans an atomic subset, skips only unselected proposals, and no-ops unchanged imports", async () => {
    const fixture = await createSanitizedWorkbookFixture();
    const beginning = await preview(fixture.buffer, fixture.scope);
    const noOp = planWorkbookImportApply({
      preview: beginning,
      expectedPreviewDigest: beginning.previewDigest,
      currentMatches: fixture.scope.matches
    });
    expect(noOp).toMatchObject({ noOp: true, skippedObservationIds: [] });

    const bothLive = await mutateWorkbook(fixture.buffer, (workbook) => {
      fixture.matchIds.forEach((matchId) => {
        const sheet = matchWorksheet(workbook, matchId);
        sheet.getCell("B2").value = "LIVE GAME";
        sheet.getCell("D10").value = "x";
      });
    });
    const livePreview = await preview(bothLive, fixture.scope);
    const proposals = livePreview.observations.filter((item) => item.candidate !== undefined);
    const plan = planWorkbookImportApply({
      preview: livePreview,
      expectedPreviewDigest: livePreview.previewDigest,
      selectedObservationIds: [proposals[0].id],
      currentMatches: fixture.scope.matches
    });
    expect(plan.selected).toHaveLength(1);
    expect(plan.skippedObservationIds).toEqual([proposals[1].id]);
    expect(plan.confirmationDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects stale preview digests and match/source changes", async () => {
    const fixture = await createSanitizedWorkbookFixture();
    const live = await mutateWorkbook(fixture.buffer, (workbook) => {
      const sheet = matchWorksheet(workbook, fixture.matchIds[0]);
      sheet.getCell("B2").value = "LIVE GAME";
      sheet.getCell("D10").value = "x";
    });
    const livePreview = await preview(live, fixture.scope);
    expect(() => planWorkbookImportApply({
      preview: livePreview,
      expectedPreviewDigest: "0".repeat(64),
      currentMatches: fixture.scope.matches
    })).toThrow(WorkbookApplyPlanningError);

    const staleMatches = fixture.scope.matches.map((match) =>
      match.matchId === fixture.matchIds[0]
        ? { ...match, matchRowVersion: match.matchRowVersion + 1 }
        : match
    );
    expectPlanningCode(
      () => planWorkbookImportApply({
        preview: livePreview,
        expectedPreviewDigest: livePreview.previewDigest,
        currentMatches: staleMatches
      }),
      "MATCH_CHANGED_AFTER_PREVIEW"
    );

    const changedParticipants = fixture.scope.matches.map((match) =>
      match.matchId === fixture.matchIds[0]
        ? {
          ...match,
          participants: match.participants.map((participant, index) =>
            index === 0
              ? {
                ...participant,
                playerId: parseStableUuid(
                  "00000000-0000-4000-8000-000000007777",
                  "tournament_player"
                )
              }
              : participant
          )
        }
        : match
    );
    expectPlanningCode(
      () => planWorkbookImportApply({
        preview: livePreview,
        expectedPreviewDigest: livePreview.previewDigest,
        currentMatches: changedParticipants
      }),
      "MATCH_PARTICIPANTS_CHANGED_AFTER_PREVIEW"
    );
  });

  it("chains a new live sheet, live revision, and final revision cumulatively", async () => {
    const fixture = await createSanitizedWorkbookFixture();
    const liveA = await mutateWorkbook(fixture.buffer, (workbook) => {
      const sheet = matchWorksheet(workbook, fixture.matchIds[0]);
      sheet.getCell("B2").value = "LIVE GAME";
      sheet.getCell("D10").value = "x";
    });
    const candidateA = candidateFor(
      await preview(liveA, fixture.scope),
      fixture.matchIds[0]
    );
    const scopeAfterA = acceptedScope(fixture.scope, candidateA, 1);
    const liveB = await mutateWorkbook(liveA, (workbook) => {
      matchWorksheet(workbook, fixture.matchIds[0]).getCell("E11").value = true;
    });
    const candidateB = candidateFor(
      await preview(liveB, scopeAfterA),
      fixture.matchIds[0]
    );
    expect(candidateB).toMatchObject({
      sourceRevisionNumber: 2,
      previousCandidateId: candidateA.id,
      reason: "workbook_update",
      proposedStatus: "in_progress"
    });
    const scopeAfterB = acceptedScope(scopeAfterA, candidateB, 2);
    const final = await mutateWorkbook(liveB, (workbook) => {
      matchWorksheet(workbook, fixture.matchIds[0]).getCell("B2").value = "FINAL";
    });
    const finalCandidate = candidateFor(
      await preview(final, scopeAfterB),
      fixture.matchIds[0]
    );
    expect(finalCandidate).toMatchObject({
      sourceRevisionNumber: 3,
      previousCandidateId: candidateB.id,
      reason: "workbook_update",
      proposedStatus: "final",
      requiresConfirmation: false
    });
  });

  it("keeps a scored match on its closed roster while an unplayed match uses a replacement", async () => {
    const fixture = await createSanitizedWorkbookFixture();
    const finalA = await mutateWorkbook(fixture.buffer, (workbook) => {
      const sheet = matchWorksheet(workbook, fixture.matchIds[0]);
      sheet.getCell("B2").value = "FINAL";
      sheet.getCell("E10").value = true;
    });
    const candidateA = candidateFor(
      await preview(finalA, fixture.scope),
      fixture.matchIds[0]
    );
    const scopeAfterA = acceptedScope(fixture.scope, candidateA, 1);
    const replacementPlayerId = parseStableUuid(
      "00000000-0000-4000-8000-000000007701",
      "tournament_player"
    );
    const replacementMembershipId = parseStableUuid(
      "00000000-0000-4000-8000-000000007702",
      "roster_membership"
    );
    const futureMatch = scopeAfterA.matches[1];
    const replacementTeamId = futureMatch.teamIds[0];
    const mixedRosterScope: CanonicalWorkbookScope = {
      ...scopeAfterA,
      matches: scopeAfterA.matches.map((match) =>
        match.matchId !== futureMatch.matchId
          ? match
          : {
            ...match,
            participants: match.participants.map((participant) =>
              participant.teamId === replacementTeamId && participant.rosterSlot === 1
                ? {
                  ...participant,
                  playerId: replacementPlayerId,
                  rosterMembershipId: replacementMembershipId,
                  displayName: "Replacement Player"
                }
                : participant
            )
          }
      )
    };
    const corrected = await mutateWorkbook(finalA, (workbook) => {
      const scored = matchWorksheet(workbook, fixture.matchIds[0]);
      scored.getCell("E10").value = null;
      scored.getCell("D10").value = true;
      const future = matchWorksheet(workbook, fixture.matchIds[1]);
      future.getCell("Z1").value = replacementPlayerId;
      future.getCell("AA1").value = replacementMembershipId;
      future.getCell("W20").value = "Replacement Player";
    });
    const correctionPreview = await preview(corrected, mixedRosterScope);
    const correction = candidateFor(correctionPreview, fixture.matchIds[0]);
    const closedMembership = scopeAfterA.matches[0].participants.find((participant) =>
      participant.teamId === replacementTeamId && participant.rosterSlot === 1
    )!.rosterMembershipId;
    expect(correction.participants.find((participant) =>
      participant.teamId === replacementTeamId && participant.rosterSlot === 1
    )?.rosterMembershipId).toBe(closedMembership);
    expect(correctionPreview.observations.find((item) =>
      item.matchId === fixture.matchIds[1]
    )).toMatchObject({ decision: "unchanged" });

    const tamperedFrozenMatch = await mutateWorkbook(corrected, (workbook) => {
      const scored = matchWorksheet(workbook, fixture.matchIds[0]);
      scored.getCell("Z9").value = replacementPlayerId;
      scored.getCell("AA9").value = replacementMembershipId;
      scored.getCell("W28").value = "Replacement Player";
    });
    expect((await preview(tamperedFrozenMatch, mixedRosterScope)).observations.find((item) =>
      item.matchId === fixture.matchIds[0]
    )).toMatchObject({
      decision: "invalid",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "SCORECARD_PARTICIPANT_FREEZE_CONFLICT" })
      ])
    });
  });

  it("requires final correction confirmation reasons and makes A-B-A identities distinct", async () => {
    const fixture = await createSanitizedWorkbookFixture();
    const finalA = await mutateWorkbook(fixture.buffer, (workbook) => {
      const sheet = matchWorksheet(workbook, fixture.matchIds[0]);
      sheet.getCell("B2").value = "FINAL";
      sheet.getCell("E10").value = true;
    });
    const previewA = await preview(finalA, fixture.scope);
    const candidateA = candidateFor(previewA, fixture.matchIds[0]);
    const scopeAfterA = acceptedScope(fixture.scope, candidateA, 1);
    const identicalReimport = await preview(finalA, scopeAfterA);
    expect(identicalReimport.observations.find((item) =>
      item.matchId === fixture.matchIds[0]
    )).toMatchObject({ decision: "unchanged" });
    const regressed = await mutateWorkbook(finalA, (workbook) => {
      matchWorksheet(workbook, fixture.matchIds[0]).getCell("B2").value = "LIVE GAME";
    });
    expect((await preview(regressed, scopeAfterA)).observations.find((item) =>
      item.matchId === fixture.matchIds[0]
    )).toMatchObject({
      decision: "invalid",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "SCORECARD_STATUS_REGRESSION" })
      ])
    });

    const finalB = await mutateWorkbook(finalA, (workbook) => {
      const sheet = matchWorksheet(workbook, fixture.matchIds[0]);
      sheet.getCell("E10").value = null;
      sheet.getCell("D10").value = true;
    });
    const previewB = await preview(finalB, scopeAfterA);
    const candidateB = candidateFor(previewB, fixture.matchIds[0]);
    expect(candidateB).toMatchObject({
      sourceRevisionNumber: 2,
      previousCandidateId: candidateA.id,
      reason: "correction",
      requiresConfirmation: true,
      requiresCorrectionReason: true
    });
    expectPlanningCode(
      () => planWorkbookImportApply({
        preview: previewB,
        expectedPreviewDigest: previewB.previewDigest,
        currentMatches: scopeAfterA.matches
      }),
      "CORRECTION_REASON_REQUIRED"
    );
    const withReason = planWorkbookImportApply({
      preview: previewB,
      expectedPreviewDigest: previewB.previewDigest,
      correctionReasons: [{
        observationId: observationFor(previewB, fixture.matchIds[0]).id,
        reason: "Corrected sanitized final row"
      }],
      currentMatches: scopeAfterA.matches
    });
    expect(withReason.selected[0].correctionReason)
      .toBe("Corrected sanitized final row");

    const scopeAfterB = acceptedScope(scopeAfterA, candidateB, 2);
    const reverted = await preview(finalA, scopeAfterB);
    const revertedCandidate = candidateFor(reverted, fixture.matchIds[0]);
    expect(revertedCandidate.fingerprint).toBe(candidateA.fingerprint);
    expect(revertedCandidate.id).not.toBe(candidateA.id);
    expect(revertedCandidate.previousCandidateId).toBe(candidateB.id);
    expect(revertedCandidate.sourceRevisionNumber).toBe(3);
  });
});

async function preview(buffer: Buffer, scope: CanonicalWorkbookScope) {
  const parsed = await new CanonicalWorkbookParser().parse({ buffer, scope });
  return createWorkbookReconciliationPreview({ parsed, scope });
}

function observationFor(preview: WorkbookReconciliationPreview, matchId: string) {
  const observation = preview.observations.find((item) =>
    item.matchId === matchId && item.candidate !== undefined
  );
  if (observation === undefined) {
    throw new Error("Expected sanitized workbook candidate observation.");
  }
  return observation;
}

function candidateFor(preview: WorkbookReconciliationPreview, matchId: string) {
  const candidate = observationFor(preview, matchId).candidate;
  if (candidate === undefined) {
    throw new Error("Expected sanitized workbook candidate.");
  }
  return candidate;
}

function acceptedScope(
  scope: CanonicalWorkbookScope,
  candidate: WorkbookMatchRevisionCandidate,
  sourceStateRowVersion: number
): CanonicalWorkbookScope {
  return {
    ...scope,
    matches: scope.matches.map((match): CanonicalMatchReconciliationScope =>
      match.matchId !== candidate.matchId
        ? match
        : {
          ...match,
          canonicalStatus: candidate.proposedStatus,
          sourceState: {
            fingerprint: candidate.fingerprint,
            candidateId: candidate.id,
            sourceRevisionNumber: candidate.sourceRevisionNumber,
            proposedStatus: candidate.proposedStatus,
            participantDigest: createWorkbookParticipantDigest(match.participants),
            rowVersion: sourceStateRowVersion
          }
        }
    )
  };
}

function expectPlanningCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Expected workbook apply planning to fail.");
  } catch (caught) {
    expect(caught).toBeInstanceOf(WorkbookApplyPlanningError);
    expect((caught as WorkbookApplyPlanningError).issues.map((issue) => issue.code))
      .toContain(code);
  }
}
