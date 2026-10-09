import { AppError } from "../../../errors";
import {
  parseBracketForm,
  parseGlobalSeedTieForm,
  parseMatchResolutionApplyForm,
  parseMatchResolutionPreviewForm,
  parsePodFinalizationForm,
  parsePodTieForm,
  parseSeedOverrideForm
} from "./admin-web-progression.form";

describe("administrator progression forms", () => {
  it("maps an operator forfeit and requires exactly one winning team", () => {
    expect(parseMatchResolutionPreviewForm({
      _csrf: "csrf",
      matchId: uuid(1),
      expectedTournamentRowVersion: "4",
      expectedMatchRowVersion: "2",
      commandType: "forfeit",
      winnerTeamId: uuid(2),
      reason: "Official forfeit"
    })).toEqual({
      matchId: uuid(1),
      request: {
        expectedTournamentRowVersion: 4,
        expectedMatchRowVersion: 2,
        commandType: "forfeit",
        winnerTeamId: uuid(2),
        reason: "Official forfeit"
      }
    });
    expect(() => parseMatchResolutionPreviewForm({
      _csrf: "csrf",
      matchId: uuid(1),
      expectedTournamentRowVersion: "4",
      expectedMatchRowVersion: "2",
      commandType: "forfeit",
      reason: "No winner"
    })).toThrow(AppError);
  });

  it("rejects duplicate, unexpected, and cross-command winner fields", () => {
    expect(() => parseMatchResolutionPreviewForm({
      _csrf: "csrf",
      matchId: [uuid(1), uuid(2)],
      expectedTournamentRowVersion: "4",
      expectedMatchRowVersion: "2",
      commandType: "cancel",
      reason: "Weather cancellation"
    })).toThrow("exactly once");
    expect(() => parseMatchResolutionPreviewForm({
      _csrf: "csrf",
      matchId: uuid(1),
      expectedTournamentRowVersion: "4",
      expectedMatchRowVersion: "2",
      commandType: "cancel",
      winnerTeamId: uuid(2),
      reason: "Weather cancellation"
    })).toThrow(AppError);
    expect(() => parseBracketForm({
      _csrf: "csrf",
      expectedTournamentRowVersion: "4",
      topology: "browser-controlled"
    }, false)).toThrow("Unexpected form field");
  });

  it("requires a strict digest for an apply command", () => {
    const request = parseMatchResolutionApplyForm({
      _csrf: "csrf",
      expectedTournamentRowVersion: "4",
      expectedMatchRowVersion: "2",
      commandType: "cancel",
      reason: "Weather cancellation",
      confirmationDigest: "a".repeat(64)
    }).request;
    expect(request.confirmationDigest).toBe("a".repeat(64));
    expect(() => parseMatchResolutionApplyForm({
      _csrf: "csrf",
      expectedTournamentRowVersion: "4",
      expectedMatchRowVersion: "2",
      commandType: "cancel",
      reason: "Weather cancellation",
      confirmationDigest: "not-a-digest"
    })).toThrow(AppError);
  });

  it("parses each official ordering as a unique complete-looking UUID list", () => {
    const common = {
      _csrf: "csrf",
      expectedTournamentRowVersion: "4",
      orderedTeamIds: `${uuid(1)}, ${uuid(2)}`,
      reason: "Official operator order"
    };
    expect(parsePodTieForm({
      ...common,
      activeCalculationId: uuid(3),
      tieGroupId: "d".repeat(64)
    }, false).request.orderedTeamIds).toEqual([uuid(1), uuid(2)]);
    expect(parseGlobalSeedTieForm({
      ...common,
      activeReviewVersionId: uuid(3),
      seedCalculationId: uuid(4),
      tieGroupId: uuid(5)
    }, false).request.orderedTeamIds).toEqual([uuid(1), uuid(2)]);
    expect(parseSeedOverrideForm({
      ...common,
      calculationId: uuid(3)
    }, false).request.orderedTeamIds).toEqual([uuid(1), uuid(2)]);
    expect(() => parseSeedOverrideForm({
      ...common,
      orderedTeamIds: `${uuid(1)},${uuid(1)}`,
      calculationId: uuid(3)
    }, false)).toThrow(AppError);
  });

  it("requires a lowercase SHA-256 digest for a pod tie-group identity", () => {
    const input = {
      _csrf: "csrf",
      expectedTournamentRowVersion: "4",
      activeCalculationId: uuid(3),
      orderedTeamIds: `${uuid(1)},${uuid(2)}`,
      reason: "Official operator order"
    };
    expect(parsePodTieForm({
      ...input,
      tieGroupId: "d".repeat(64)
    }, false).request.tieGroupId).toBe("d".repeat(64));
    expect(() => parsePodTieForm({
      ...input,
      tieGroupId: uuid(4)
    }, false)).toThrow(AppError);
    expect(() => parsePodTieForm({
      ...input,
      tieGroupId: "D".repeat(64)
    }, false)).toThrow(AppError);
  });

  it("supports optional finalization reasons and bracket confirmation", () => {
    expect(parsePodFinalizationForm({
      _csrf: "csrf",
      expectedTournamentRowVersion: "4",
      calculationId: uuid(3),
      reason: ""
    }, false).request).toEqual({
      expectedTournamentRowVersion: 4,
      calculationId: uuid(3)
    });
    expect(parseBracketForm({
      _csrf: "csrf",
      expectedTournamentRowVersion: "4",
      confirmationDigest: "b".repeat(64)
    }, true).request).toEqual({
      expectedTournamentRowVersion: 4,
      confirmationDigest: "b".repeat(64)
    });
  });
});

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}
