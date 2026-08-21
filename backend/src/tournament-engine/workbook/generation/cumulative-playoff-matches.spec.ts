import { parseStableUuid, PodId, TournamentId, TournamentTeamId } from "../../domain";
import {
  ActiveBracketMatchInput,
  BracketResolvedMatch,
  generateMirroredBracketTopology,
  resolveBracketAdvancements,
  SINGLE_ELIMINATION_BRACKET_RULES_VERSION
} from "../../bracket";
import { EffectiveSeedPlan } from "../../seeding";
import { selectCumulativePlayoffWorkbookMatches } from "./cumulative-playoff-matches";

describe("selectCumulativePlayoffWorkbookMatches", () => {
  it("selects only ordinary matches with two resolved teams", () => {
    const topology = generateMirroredBracketTopology({
      tournamentId: tournamentId(),
      rulesVersion: SINGLE_ELIMINATION_BRACKET_RULES_VERSION,
      bracketSize: 8,
      allowByes: true,
      effectiveSeedPlan: effectiveSeeds(3)
    });
    const resolution = resolveBracketAdvancements({
      topology,
      activeMatches: []
    });
    const selected = selectCumulativePlayoffWorkbookMatches({
      resolution,
      firstSequence: 49
    });

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      id: resolution.playableMatches[0].matchId,
      stage: "playoffs",
      sequence: 49,
      roundNumber: 2,
      sequenceInRound: 2,
      participantTeamIds: [teamId(2), teamId(3)]
    });
    expect(selected.every((match) => match.participantTeamIds.length === 2))
      .toBe(true);
  });

  it("returns no sheets for a one-qualifier field resolved entirely by byes", () => {
    const topology = generateMirroredBracketTopology({
      tournamentId: tournamentId(),
      rulesVersion: SINGLE_ELIMINATION_BRACKET_RULES_VERSION,
      bracketSize: 2,
      allowByes: true,
      effectiveSeedPlan: effectiveSeeds(1)
    });
    const resolution = resolveBracketAdvancements({
      topology,
      activeMatches: []
    });

    expect(resolution.championTeamId).toBe(teamId(1));
    expect(selectCumulativePlayoffWorkbookMatches({
      resolution,
      firstSequence: 1
    })).toEqual([]);
  });

  it("retains earlier scorecards and adds newly playable rounds cumulatively", () => {
    const topology = generateMirroredBracketTopology({
      tournamentId: tournamentId(),
      rulesVersion: SINGLE_ELIMINATION_BRACKET_RULES_VERSION,
      bracketSize: 4,
      allowByes: false,
      effectiveSeedPlan: effectiveSeeds(4)
    });
    const beginning = resolveBracketAdvancements({ topology, activeMatches: [] });
    const semifinalResults = beginning.rounds[0].matches.map(completed);
    const middle = resolveBracketAdvancements({
      topology,
      activeMatches: semifinalResults
    });
    const finalResult = completed(middle.rounds[1].matches[0]);
    const end = resolveBracketAdvancements({
      topology,
      activeMatches: [...semifinalResults, finalResult]
    });

    const beginningSheets = selectCumulativePlayoffWorkbookMatches({
      resolution: beginning,
      firstSequence: 49
    });
    const middleSheets = selectCumulativePlayoffWorkbookMatches({
      resolution: middle,
      firstSequence: 49
    });
    const endSheets = selectCumulativePlayoffWorkbookMatches({
      resolution: end,
      firstSequence: 49
    });
    expect(beginningSheets).toHaveLength(2);
    expect(middleSheets).toHaveLength(3);
    expect(endSheets).toHaveLength(3);
    expect(middleSheets.slice(0, 2)).toEqual(beginningSheets);
    expect(endSheets).toEqual(middleSheets);
    expect(end.championTeamId).not.toBeNull();
  });
});

function completed(match: BracketResolvedMatch): ActiveBracketMatchInput {
  if (match.matchInstance === null || match.slots[0].state.type !== "team") {
    throw new Error("Expected a playable match with a resolved first team.");
  }
  return {
    bracketMatchId: match.id,
    matchId: match.matchInstance.matchId,
    instanceNumber: match.matchInstance.instanceNumber,
    participantTeamIds: match.matchInstance.participantTeamIds,
    participantsFrozen: true,
    status: "final",
    scoreAvailability: "complete",
    winnerTeamId: match.slots[0].state.teamId
  };
}

function effectiveSeeds(count: number): EffectiveSeedPlan {
  return {
    tournamentId: tournamentId(),
    seedCalculationId: stableUuid(100),
    seedCalculationInputDigest: "a".repeat(64),
    source: "calculated",
    overrideDigest: null,
    audit: null,
    rows: Array.from({ length: count }, (_, index) => ({
      teamId: teamId(index + 1),
      podId: podId(index + 1),
      calculatedSeed: index + 1,
      effectiveSeed: index + 1
    })),
    changes: []
  };
}

function tournamentId(): TournamentId {
  return parseStableUuid(stableUuid(1), "tournament");
}

function teamId(index: number): TournamentTeamId {
  return parseStableUuid(stableUuid(2_000 + index), "tournament_team");
}

function podId(index: number): PodId {
  return parseStableUuid(stableUuid(3_000 + index), "pod");
}

function stableUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
