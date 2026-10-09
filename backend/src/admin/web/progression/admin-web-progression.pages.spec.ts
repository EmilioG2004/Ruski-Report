import { TournamentProgressionRecord } from "../../../tournament-engine/persistence";
import {
  renderBracketConfirmationPage,
  renderMatchResolutionConfirmationPage,
  renderTournamentProgressionPage
} from "./admin-web-progression.pages";

describe("administrator progression pages", () => {
  it("renders every progression control as escaped no-JavaScript HTML", () => {
    const html = renderTournamentProgressionPage({
      principal: PRINCIPAL,
      csrfToken: "csrf-token",
      progression: PROGRESSION
    });
    expect(html).toContain("Operator match resolution");
    expect(html).toContain("Preview pod tie decision");
    expect(html).toContain("Preview pod finalization");
    expect(html).toContain("Preview qualifier tie decision");
    expect(html).toContain("Preview seed override");
    expect(html).toContain("Preview bracket and cumulative workbook");
    expect(html).toContain("&lt;unsafe-team&gt;");
    expect(html).not.toContain("<unsafe-team>");
    expect(html).not.toContain("<script");
  });

  it("does not expose apply when a match resolution requires a cascade", () => {
    const html = renderMatchResolutionConfirmationPage({
      principal: PRINCIPAL,
      csrfToken: "csrf-token",
      progression: PROGRESSION,
      matchId: uuid(20),
      request: {
        expectedTournamentRowVersion: 5,
        expectedMatchRowVersion: 2,
        commandType: "forfeit",
        winnerTeamId: TEAM_ONE,
        reason: "Official correction"
      },
      preview: {
        tournamentId: TOURNAMENT_ID as never,
        matchId: uuid(20) as never,
        currentStatus: "final",
        proposedStatus: "forfeited",
        proposedWinnerTeamId: TEAM_ONE as never,
        bracketMatchId: uuid(21) as never,
        dependentBracketMatchIds: [uuid(22) as never],
        requiresCascade: true,
        confirmationDigest: "a".repeat(64)
      }
    });
    expect(html).toContain("Protected dependency");
    expect(html).not.toContain("Confirm forfeit");
    expect(html).not.toContain("confirmationDigest");
  });

  it("renders exact protected cascade actions before confirmation", () => {
    const priorMatchId = uuid(23);
    const replacementMatchId = uuid(24);
    const bracketMatchId = uuid(25);
    const html = renderMatchResolutionConfirmationPage({
      principal: PRINCIPAL,
      csrfToken: "csrf-token",
      progression: PROGRESSION,
      matchId: uuid(20),
      request: {
        expectedTournamentRowVersion: 5,
        expectedMatchRowVersion: 2,
        commandType: "forfeit",
        winnerTeamId: TEAM_ONE,
        reason: "Official correction"
      },
      preview: {
        tournamentId: TOURNAMENT_ID as never,
        matchId: uuid(20) as never,
        currentStatus: "final",
        proposedStatus: "forfeited",
        proposedWinnerTeamId: TEAM_ONE as never,
        bracketMatchId: uuid(21) as never,
        dependentBracketMatchIds: [bracketMatchId as never],
        requiresCascade: true,
        confirmationDigest: "a".repeat(64),
        cascadeImpact: {
          confirmationDigest: "b".repeat(64),
          actionCount: 1,
          replacementCount: 1,
          actions: [{
            bracketMatchId,
            action: "replace_started_match",
            previousMatchId: priorMatchId,
            replacementMatchId
          }]
        }
      }
    });
    expect(html).toContain("Confirm forfeit");
    expect(html).toContain("replace_started_match");
    expect(html).toContain(priorMatchId);
    expect(html).toContain(replacementMatchId);
    expect(html).toContain(`value="${"b".repeat(64)}"`);
  });

  it("freezes only server-derived bracket preview values in confirmation", () => {
    const html = renderBracketConfirmationPage({
      principal: PRINCIPAL,
      csrfToken: "csrf-token",
      progression: PROGRESSION,
      preview: {
        tournamentId: TOURNAMENT_ID,
        tournamentRowVersion: 5,
        seedCalculationId: CALCULATION_ID,
        bracketId: uuid(30),
        topologyDigest: "b".repeat(64),
        confirmationDigest: "c".repeat(64),
        bracketSize: 4,
        qualifierCount: 3,
        roundCount: 2,
        playableMatchCount: 2,
        byeCount: 1,
        placementOrder: [1, 4, 2, 3]
      }
    });
    expect(html).toContain("Publish bracket and workbook");
    expect(html).toContain(`value="${"c".repeat(64)}"`);
    expect(html).not.toContain("topologyDigest");
    expect(html).not.toContain("name=\"bracketId\"");
  });
});

const TOURNAMENT_ID = uuid(1);
const POD_ID = uuid(2);
const TEAM_ONE = uuid(3);
const TEAM_TWO = uuid(4);
const CALCULATION_ID = uuid(5);
const POD_TIE_ID = uuid(6);
const REVIEW_ID = uuid(7);
const SEED_TIE_ID = uuid(8);

const PRINCIPAL = {
  administratorId: uuid(40),
  loginName: "operator",
  displayName: "Operator",
  sessionId: uuid(41),
  authenticatedAt: "2027-01-01T00:00:00.000Z",
  expiresAt: "2027-01-02T00:00:00.000Z"
};

const PROGRESSION = {
  tournamentId: TOURNAMENT_ID,
  lifecycle: "seeding_review",
  rowVersion: 5,
  qualifiersPerPod: 1,
  bracketSize: 4,
  pods: [{
    podId: POD_ID,
    publicKey: POD_ID,
    name: "Pod <unsafe>",
    sequence: 1,
    activeCalculationId: CALCULATION_ID,
    calculationStatus: "finalizable",
    rows: [{
      teamId: TEAM_ONE,
      teamName: "<unsafe-team>",
      rank: null,
      wins: 1,
      losses: 1,
      cupDifferential: 0,
      makes: 2,
      attempts: 4,
      shootingPercentage: 0.5,
      qualified: false,
      tieGroupId: POD_TIE_ID
    }, {
      teamId: TEAM_TWO,
      teamName: "Safe Team",
      rank: null,
      wins: 1,
      losses: 1,
      cupDifferential: 0,
      makes: 2,
      attempts: 4,
      shootingPercentage: 0.5,
      qualified: false,
      tieGroupId: POD_TIE_ID
    }],
    tieGroups: [{
      tieGroupId: POD_TIE_ID,
      teamIds: [TEAM_ONE, TEAM_TWO],
      resolved: false
    }]
  }],
  activeGlobalSeedReview: {
    reviewVersionId: REVIEW_ID,
    seedCalculationId: CALCULATION_ID,
    status: "unresolved_tie",
    tieGroups: [{
      tieGroupId: SEED_TIE_ID,
      teamIds: [TEAM_ONE, TEAM_TWO],
      resolved: false
    }]
  },
  activeSeedCalculationId: CALCULATION_ID,
  effectiveSeeds: [{
    teamId: TEAM_ONE,
    calculatedSeed: 1,
    effectiveSeed: 1
  }, {
    teamId: TEAM_TWO,
    calculatedSeed: 2,
    effectiveSeed: 2
  }]
} as unknown as TournamentProgressionRecord;

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}
