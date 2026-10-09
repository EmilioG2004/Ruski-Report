import {
  calculatePodStandings,
  PodStandingsValidationError
} from "./pod-standings";
import {
  completeSanitizedRoundRobin,
  sanitizedBlockingMatch,
  sanitizedCancelledMatch,
  sanitizedFinalMatch,
  sanitizedForfeitMatch,
  sanitizedPodStandingsInput,
  sanitizedTeamId,
  sanitizedTieResolution
} from "./fixtures/sanitized-pod-standings.fixture";

describe("pod standings", () => {
  it("simulates a complete main-preset pod and qualifies its top two", () => {
    const calculation = calculatePodStandings(sanitizedPodStandingsInput(4, 2, [
      sanitizedFinalMatch(1, 1, 2, 3, 1),
      sanitizedFinalMatch(2, 1, 3, 3, 1),
      sanitizedFinalMatch(3, 1, 4, 2, 0),
      sanitizedFinalMatch(4, 2, 3, 3, 1),
      sanitizedFinalMatch(5, 2, 4, 2, 0),
      sanitizedFinalMatch(6, 3, 4, 3, 1)
    ]));

    expect(calculation).toMatchObject({
      status: "finalizable",
      scheduledMatchCount: 6,
      requiredMatchCount: 6,
      resolvedRequiredMatchCount: 6,
      cancelledMatchCount: 0,
      blockingMatchIds: []
    });
    expect(calculation.rows.map((row) => ({
      teamId: row.teamId,
      rank: row.rank,
      wins: row.wins,
      losses: row.losses,
      cupDifferential: row.cupDifferential,
      qualified: row.qualified
    }))).toEqual([
      row(1, 1, 3, 0, 6, true),
      row(2, 2, 2, 1, 2, true),
      row(3, 3, 1, 2, -2, false),
      row(4, 4, 0, 3, -6, false)
    ]);
    expect(calculation.inputDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("supports repeated pairings in a generalized pod", () => {
    const matches = [
      sanitizedFinalMatch(10, 1, 2, 2, 0, shooting(1, 1, 0, 1)),
      sanitizedFinalMatch(11, 1, 2, 2, 0, shooting(0, 1, 0, 1)),
      sanitizedFinalMatch(12, 2, 3, 2, 0, shooting(1, 1, 0, 1)),
      sanitizedFinalMatch(13, 2, 3, 2, 0, shooting(0, 1, 0, 1)),
      sanitizedFinalMatch(14, 3, 1, 2, 0, shooting(1, 1, 0, 1)),
      sanitizedFinalMatch(15, 3, 1, 2, 0, shooting(0, 1, 0, 1))
    ];
    const unresolved = calculatePodStandings(
      sanitizedPodStandingsInput(3, 1, matches, undefined, 2)
    );
    expect(unresolved.status).toBe("unresolved_tie");
    expect(unresolved.tieGroups).toHaveLength(1);

    const tieGroup = unresolved.tieGroups[0];
    const finalized = calculatePodStandings(sanitizedPodStandingsInput(
      3,
      1,
      matches,
      [sanitizedTieResolution(1, tieGroup.tieGroupId, [3, 1, 2])],
      2
    ));
    expect(finalized.status).toBe("finalizable");
    expect(finalized.rows.map((item) => [item.teamId, item.rank, item.qualified]))
      .toEqual([
        [sanitizedTeamId(3), 1, true],
        [sanitizedTeamId(1), 2, false],
        [sanitizedTeamId(2), 3, false]
      ]);
    expect(finalized.tieGroups[0]).toMatchObject({
      shootingPercentageNumerator: 1,
      shootingPercentageDenominator: 4,
      resolved: true
    });
  });

  it("uses exact rational shooting percentages for ties", () => {
    const matches = [
      sanitizedFinalMatch(20, 1, 2, 2, 0, shooting(1, 2, 0, 1)),
      sanitizedFinalMatch(21, 2, 3, 2, 0, shooting(2, 5, 0, 1)),
      sanitizedFinalMatch(22, 3, 1, 2, 0, shooting(3, 8, 0, 1))
    ];
    const result = calculatePodStandings(
      sanitizedPodStandingsInput(3, 1, matches)
    );

    expect(result.status).toBe("unresolved_tie");
    expect(result.rows.map((item) => [item.makes, item.attempts]))
      .toEqual([[1, 3], [2, 6], [3, 9]]);
    expect(result.rows.every((item) => item.rank === null)).toBe(true);
    expect(result.rows.every((item) => !item.qualified)).toBe(true);
    expect(result.tieGroups[0]).toMatchObject({
      shootingPercentageNumerator: 1,
      shootingPercentageDenominator: 3,
      shootingPercentage: 1 / 3
    });
  });

  it("orders a defined zero percentage above a null percentage", () => {
    const matches = completeSanitizedRoundRobin(6, 1, [
        sanitizedForfeitMatch(30, 1, 3),
        sanitizedForfeitMatch(31, 4, 1),
        sanitizedFinalMatch(32, 2, 5, 2, 0, shooting(0, 1, 0, 1)),
        sanitizedFinalMatch(33, 6, 2, 2, 0, shooting(0, 1, 0, 1))
      ], "cancelled", 300);
    const result = calculatePodStandings(
      sanitizedPodStandingsInput(6, 2, matches)
    );
    const definedZero = result.rows.find((item) => item.teamId === sanitizedTeamId(2));
    const noAttempts = result.rows.find((item) => item.teamId === sanitizedTeamId(1));

    expect(definedZero).toMatchObject({
      wins: 1,
      losses: 1,
      cupDifferential: 0,
      shootingPercentage: 0
    });
    expect(noAttempts).toMatchObject({
      wins: 1,
      losses: 1,
      cupDifferential: 0,
      shootingPercentage: null
    });
    expect(definedZero?.displayOrder).toBeLessThan(noAttempts?.displayOrder ?? 0);
  });

  it("implements cancellation, forfeit, and every blocking status", () => {
    const matches = completeSanitizedRoundRobin(8, 1, [
        sanitizedFinalMatch(40, 1, 2, 2, 0),
        sanitizedForfeitMatch(41, 3, 4),
        sanitizedCancelledMatch(42, 1, 3),
        sanitizedBlockingMatch(43, 2, 4, "scheduled"),
        sanitizedBlockingMatch(44, 5, 6, "postponed"),
        sanitizedBlockingMatch(45, 6, 7, "in_progress"),
        sanitizedBlockingMatch(46, 7, 8, "final")
      ], "scheduled", 400);
    const result = calculatePodStandings(
      sanitizedPodStandingsInput(8, 2, matches)
    );

    expect(result).toMatchObject({
      status: "provisional",
      scheduledMatchCount: 28,
      requiredMatchCount: 27,
      resolvedRequiredMatchCount: 2,
      cancelledMatchCount: 1
    });
    expect(result.matchInputs.slice(0, 7).map((match) => [
      match.disposition,
      match.blockingReason ?? null
    ])).toEqual([
      ["included_final", null],
      ["included_forfeit", null],
      ["excluded_cancelled", null],
      ["blocking", "scheduled"],
      ["blocking", "postponed"],
      ["blocking", "in_progress"],
      ["blocking", "final_unrecorded"]
    ]);
    expect(result.rows.find((item) => item.teamId === sanitizedTeamId(3)))
      .toMatchObject({ wins: 1, losses: 0, cupDifferential: 0, attempts: 0 });
    expect(result.rows.find((item) => item.teamId === sanitizedTeamId(4)))
      .toMatchObject({ wins: 0, losses: 1, cupDifferential: 0, attempts: 0 });
    expect(result.rows.every((item) => !item.qualified)).toBe(true);
  });

  it("changes immutable input identity when a correction becomes active", () => {
    const originalMatch = sanitizedFinalMatch(50, 1, 2, 2, 0);
    const correctedSource = sanitizedFinalMatch(51, 2, 1, 3, 0);
    const correctedMatch = { ...correctedSource, matchId: originalMatch.matchId };
    const original = calculatePodStandings(
      sanitizedPodStandingsInput(2, 1, [originalMatch])
    );
    const corrected = calculatePodStandings(
      sanitizedPodStandingsInput(2, 1, [correctedMatch])
    );

    expect(original.inputDigest).not.toBe(corrected.inputDigest);
    expect(original.matchInputs[0]?.revisionId)
      .not.toBe(corrected.matchInputs[0]?.revisionId);
    expect(original.rows[0]?.teamId).toBe(sanitizedTeamId(1));
    expect(corrected.rows[0]?.teamId).toBe(sanitizedTeamId(2));
  });

  it("is idempotent across non-semantic input ordering", () => {
    const matches = [
      sanitizedFinalMatch(60, 1, 2, 3, 1),
      sanitizedFinalMatch(61, 1, 3, 2, 0),
      sanitizedFinalMatch(62, 2, 3, 2, 0)
    ];
    const firstInput = sanitizedPodStandingsInput(3, 1, matches);
    const reorderedInput = {
      ...firstInput,
      teams: [...firstInput.teams].reverse(),
      matches: [...matches].reverse().map((match) => ({
        ...match,
        teams: [match.teams[1], match.teams[0]] as const
      }))
    };
    const first = calculatePodStandings(firstInput);
    const reordered = calculatePodStandings(reorderedInput);

    expect(reordered.inputDigest).toBe(first.inputDigest);
    expect(reordered).toEqual(first);
  });

  it("rejects partial, duplicate, and stale tie resolutions", () => {
    const matches = [
      sanitizedFinalMatch(70, 1, 2, 2, 0, shooting(1, 2, 0, 1)),
      sanitizedFinalMatch(71, 2, 3, 2, 0, shooting(2, 5, 0, 1)),
      sanitizedFinalMatch(72, 3, 1, 2, 0, shooting(3, 8, 0, 1))
    ];
    const unresolved = calculatePodStandings(
      sanitizedPodStandingsInput(3, 1, matches)
    );
    const groupId = unresolved.tieGroups[0]?.tieGroupId ?? "";

    expectValidationCode(
      () => calculatePodStandings(sanitizedPodStandingsInput(
        3,
        1,
        matches,
        [sanitizedTieResolution(2, groupId, [1, 2])]
      )),
      "INEXACT_TIE_RESOLUTION"
    );
    expectValidationCode(
      () => calculatePodStandings(sanitizedPodStandingsInput(
        3,
        1,
        matches,
        [sanitizedTieResolution(3, groupId, [1, 1, 2])]
      )),
      "INEXACT_TIE_RESOLUTION"
    );
    expectValidationCode(
      () => calculatePodStandings(sanitizedPodStandingsInput(
        3,
        1,
        matches,
        [sanitizedTieResolution(4, "f".repeat(64), [1, 2, 3])]
      )),
      "STALE_TIE_RESOLUTION"
    );
  });

  it("rejects inconsistent final, forfeit, and statistic provenance", () => {
    const final = sanitizedFinalMatch(80, 1, 2, 2, 0);
    expectValidationCode(
      () => calculatePodStandings(sanitizedPodStandingsInput(2, 1, [{
        ...final,
        teams: [{ ...final.teams[0], score: 1 }, final.teams[1]]
      }])),
      "INCONSISTENT_MATCH_METRICS"
    );
    const forfeit = sanitizedForfeitMatch(81, 1, 2);
    expectValidationCode(
      () => calculatePodStandings(sanitizedPodStandingsInput(2, 1, [{
        ...forfeit,
        teams: [{ ...forfeit.teams[0], result: "loss" }, forfeit.teams[1]]
      }])),
      "INVALID_FORFEIT_RESULT"
    );
    expectValidationCode(
      () => calculatePodStandings(sanitizedPodStandingsInput(2, 1, [{
        ...final,
        statisticInputDigest: undefined
      }])),
      "STATISTIC_DIGEST_REQUIRED"
    );
  });

  it("rejects a missing or overrepresented scheduled pairing", () => {
    const oneMatch = sanitizedFinalMatch(90, 1, 2, 2, 0);
    expectValidationCode(
      () => calculatePodStandings(sanitizedPodStandingsInput(3, 1, [oneMatch])),
      "INCOMPLETE_POD_SCHEDULE"
    );
    expectValidationCode(
      () => calculatePodStandings(sanitizedPodStandingsInput(3, 1, [
        oneMatch,
        sanitizedFinalMatch(91, 1, 2, 3, 0),
        sanitizedFinalMatch(92, 1, 3, 2, 0)
      ])),
      "INVALID_PAIR_MULTIPLICITY"
    );
  });
});

function row(
  teamSequence: number,
  rank: number,
  wins: number,
  losses: number,
  cupDifferential: number,
  qualified: boolean
) {
  return {
    teamId: sanitizedTeamId(teamSequence),
    rank,
    wins,
    losses,
    cupDifferential,
    qualified
  };
}

function shooting(
  leftMakes: number,
  leftAttempts: number,
  rightMakes: number,
  rightAttempts: number
) {
  return { leftMakes, leftAttempts, rightMakes, rightAttempts };
}

function expectValidationCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Expected pod standings validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(PodStandingsValidationError);
    expect((error as PodStandingsValidationError).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  }
}
