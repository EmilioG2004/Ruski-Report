import { AppError } from "../../errors";
import {
  parseBracketPublication,
  parseMatchResolutionApply,
  parsePodTieResolution,
  parseSeedOverride
} from "./admin-tournament-progression.validator";

const ID_ONE = "00000000-0000-4000-8000-000000000001";
const ID_TWO = "00000000-0000-4000-8000-000000000002";
const DIGEST = "a".repeat(64);

describe("admin tournament progression validator", () => {
  it("parses a confirmed forfeit without deriving identity from names", () => {
    expect(parseMatchResolutionApply({
      expectedTournamentRowVersion: 4,
      expectedMatchRowVersion: 2,
      commandType: "forfeit",
      winnerTeamId: ID_ONE,
      reason: "Team two forfeited.",
      confirmationDigest: DIGEST
    })).toEqual({
      expectedTournamentRowVersion: 4,
      expectedMatchRowVersion: 2,
      commandType: "forfeit",
      winnerTeamId: ID_ONE,
      reason: "Team two forfeited.",
      confirmationDigest: DIGEST
    });
  });

  it("requires a winner only for a forfeit", () => {
    expect(() => parseMatchResolutionApply({
      expectedTournamentRowVersion: 4,
      expectedMatchRowVersion: 2,
      commandType: "forfeit",
      reason: "Missing winner.",
      confirmationDigest: DIGEST
    })).toThrow(AppError);
    expect(() => parseMatchResolutionApply({
      expectedTournamentRowVersion: 4,
      expectedMatchRowVersion: 2,
      commandType: "cancel",
      winnerTeamId: ID_ONE,
      reason: "Cancelled match.",
      confirmationDigest: DIGEST
    })).toThrow(AppError);
  });

  it("accepts only complete duplicate-free stable identity orders", () => {
    expect(parseSeedOverride({
      expectedTournamentRowVersion: 8,
      calculationId: ID_ONE,
      orderedTeamIds: [ID_ONE, ID_TWO],
      reason: "Official seed review.",
      confirmationDigest: DIGEST
    }).orderedTeamIds).toEqual([ID_ONE, ID_TWO]);
    expect(() => parseSeedOverride({
      expectedTournamentRowVersion: 8,
      calculationId: ID_ONE,
      orderedTeamIds: [ID_ONE, ID_ONE],
      reason: "Duplicate order.",
      confirmationDigest: DIGEST
    })).toThrow(AppError);
  });

  it("validates tie and bracket confirmation identities", () => {
    expect(parsePodTieResolution({
      expectedTournamentRowVersion: 5,
      activeCalculationId: ID_ONE,
      tieGroupId: DIGEST,
      orderedTeamIds: [ID_TWO, ID_ONE],
      reason: "Administrator tiebreak.",
      confirmationDigest: DIGEST
    }).orderedTeamIds).toEqual([ID_TWO, ID_ONE]);
    expect(() => parsePodTieResolution({
      expectedTournamentRowVersion: 5,
      activeCalculationId: ID_ONE,
      tieGroupId: ID_TWO,
      orderedTeamIds: [ID_TWO, ID_ONE],
      reason: "Administrator tiebreak.",
      confirmationDigest: DIGEST
    })).toThrow(AppError);
    expect(parseBracketPublication({
      expectedTournamentRowVersion: 9,
      confirmationDigest: DIGEST
    })).toEqual({
      expectedTournamentRowVersion: 9,
      confirmationDigest: DIGEST
    });
  });
});
