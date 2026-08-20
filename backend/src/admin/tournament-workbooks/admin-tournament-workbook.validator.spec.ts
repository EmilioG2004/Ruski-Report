import { AppError } from "../../errors";
import {
  parseGenerateWorkbookRequest,
  parseWorkbookApplyForm,
  parseWorkbookApplyRequest,
  parseWorkbookAssignmentForm,
  parseWorkbookAssignmentsRequest
} from "./admin-tournament-workbook.validator";

describe("administrator workbook request validation", () => {
  const observationOne = uuid(1);
  const observationTwo = uuid(2);
  const matchOne = uuid(11);

  it("parses generation row versions without accepting fractional values", () => {
    expect(parseGenerateWorkbookRequest({
      expectedTournamentRowVersion: "3"
    })).toEqual({ expectedTournamentRowVersion: 3 });
    expect(() => parseGenerateWorkbookRequest({
      expectedTournamentRowVersion: "3.5"
    })).toThrow(AppError);
  });

  it("parses exact copied-blank assignments from JSON and flat forms", () => {
    expect(parseWorkbookAssignmentsRequest({
      expectedPreviewDigest: "a".repeat(64),
      assignments: { [observationOne]: matchOne }
    })).toEqual({
      expectedPreviewDigest: "a".repeat(64),
      assignments: { [observationOne]: matchOne }
    });
    expect(parseWorkbookAssignmentForm({
      _csrf: "secret",
      expectedPreviewDigest: "a".repeat(64),
      [`assignments.${observationOne}`]: matchOne
    })).toEqual({
      expectedPreviewDigest: "a".repeat(64),
      assignments: { [observationOne]: matchOne }
    });
  });

  it("derives skipped browser observations and normalizes correction reasons", () => {
    const request = parseWorkbookApplyForm({
      previewDigest: "b".repeat(64),
      acceptedObservationIds: observationOne,
      [`correctionReasons.${observationOne}`]: "  corrected   final score  "
    }, [observationOne, observationTwo]);
    expect(parseWorkbookApplyRequest(request)).toEqual({
      previewDigest: "b".repeat(64),
      acceptedObservationIds: [observationOne],
      skippedObservationIds: [observationTwo],
      correctionReasons: { [observationOne]: "corrected final score" }
    });
  });

  it("rejects selection overlap and foreign identifiers", () => {
    expect(() => parseWorkbookApplyRequest({
      previewDigest: "c".repeat(64),
      acceptedObservationIds: [observationOne],
      skippedObservationIds: [observationOne],
      correctionReasons: {}
    })).toThrow("both accepted and skipped");
    expect(() => parseWorkbookAssignmentsRequest({
      assignments: { "not-an-id": matchOne }
    })).toThrow("stable identifiers");
  });
});

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}
