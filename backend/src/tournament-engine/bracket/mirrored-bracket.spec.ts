import {
  createStablePlayoffMatchInstanceId
} from "./bracket-identity";
import {
  parseStableUuid,
  PodId,
  TournamentId,
  TournamentTeamId
} from "../domain";
import { EffectiveSeedPlan } from "../seeding";
import {
  analyzeBracketCorrectionImpact,
  confirmBracketCorrectionImpact
} from "./correction-impact";
import {
  createMirroredSeedPlacementOrder,
  generateMirroredBracketTopology,
  resolveBracketAdvancements
} from "./mirrored-bracket";
import {
  ActiveBracketMatchInput,
  BracketResolvedMatch,
  BracketResolutionPlan,
  SINGLE_ELIMINATION_BRACKET_RULES_VERSION
} from "./contracts";

describe("standard mirrored single-elimination bracket", () => {
  it("assigns deterministic distinct IDs to A-to-B-to-A replacement instances", () => {
    const bracketMatchId = parseStableUuid(
      stableUuid(4_001),
      "bracket_match"
    );
    const ids = [1, 2, 3].map((instanceNumber) =>
      createStablePlayoffMatchInstanceId({
        tournamentId: tournamentId(),
        bracketMatchId,
        instanceNumber
      })
    );

    expect(new Set(ids).size).toBe(3);
    expect([1, 2, 3].map((instanceNumber) =>
      createStablePlayoffMatchInstanceId({
        tournamentId: tournamentId(),
        bracketMatchId,
        instanceNumber
      })
    )).toEqual(ids);
  });

  it.each([
    [4, [1, 4, 2, 3]],
    [8, [1, 8, 4, 5, 2, 7, 3, 6]],
    [16, [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]]
  ])("creates the standard mirrored %i-seed placement", (size, expected) => {
    expect(createMirroredSeedPlacementOrder(size as number)).toEqual(expected);
  });

  it("creates the deterministic main topology with no same-pod avoidance", () => {
    const effective = effectiveSeedPlan(16, () => podId(1));
    const first = topology(16, effective, false);
    const shuffled = topology(16, {
      ...effective,
      rows: [...effective.rows].reverse()
    }, false);
    const initial = resolveBracketAdvancements({
      topology: first,
      activeMatches: []
    });

    expect(first.rounds).toHaveLength(4);
    expect(first.rounds.flatMap((round) => round.matches)).toHaveLength(15);
    expect(first.rounds[0].matches).toHaveLength(8);
    expect(first.placementOrder).toEqual([
      1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11
    ]);
    expect(first.effectiveSeeds.every((seed) => seed.podId === podId(1))).toBe(true);
    expect(shuffled).toEqual(first);
    expect(initial.playableMatches).toHaveLength(8);
    expect(initial.rounds[0].matches.every((match) => match.state === "ready"))
      .toBe(true);
    expect(initial.rounds.slice(1).flatMap((round) => round.matches)
      .every((match) => match.state === "waiting")).toBe(true);
  });

  it("assigns byes to the highest seeds and propagates empty branches without scored matches", () => {
    const six = resolveBracketAdvancements({
      topology: topology(8, effectiveSeedPlan(6), true),
      activeMatches: []
    });
    const three = resolveBracketAdvancements({
      topology: topology(8, effectiveSeedPlan(3), true),
      activeMatches: []
    });

    expect(six.rounds[0].matches.map((match) => [
      match.state,
      match.winnerTeamId
    ])).toEqual([
      ["automatic_advance", teamId(1)],
      ["ready", null],
      ["automatic_advance", teamId(2)],
      ["ready", null]
    ]);
    expect(six.playableMatches).toHaveLength(2);
    expect(three.rounds[0].matches.map((match) => match.state)).toEqual([
      "automatic_advance",
      "empty",
      "automatic_advance",
      "automatic_advance"
    ]);
    expect(three.rounds[1].matches[0]).toMatchObject({
      state: "automatic_advance",
      winnerTeamId: teamId(1),
      matchInstance: null
    });
    expect(three.playableMatches).toHaveLength(1);
  });

  it("advances final and forfeit winners and produces a champion", () => {
    const generated = resolveBracketAdvancements({
      topology: topology(4, effectiveSeedPlan(4), false),
      activeMatches: []
    });
    const semifinalResults = generated.rounds[0].matches.map((match) =>
      completed(match, match.slots[0].state.type === "team"
        ? match.slots[0].state.teamId
        : fail("Expected resolved semifinal team."))
    );
    const afterSemifinals = resolveBracketAdvancements({
      topology: generated.topology,
      activeMatches: semifinalResults
    });
    const final = afterSemifinals.rounds[1].matches[0];
    const finalWinner = final.slots[1].state.type === "team"
      ? final.slots[1].state.teamId
      : fail("Expected resolved final team.");
    const completedFinal = active(final, {
      status: "forfeited",
      scoreAvailability: "not_applicable",
      winnerTeamId: finalWinner,
      participantsFrozen: true
    });
    const completedBracket = resolveBracketAdvancements({
      topology: generated.topology,
      activeMatches: [...semifinalResults, completedFinal]
    });

    expect(final.state).toBe("ready");
    expect(completedBracket.championTeamId).toBe(finalWinner);
    expect(completedBracket.rounds[1].matches[0].state).toBe("completed");
  });

  it.each([
    ["cancelled", "not_applicable", "cancelled"],
    ["final", "unrecorded", "final_unrecorded"]
  ] as const)(
    "blocks %s playoff results instead of advancing them",
    (status, scoreAvailability, reason) => {
      const generated = resolveBracketAdvancements({
        topology: topology(4, effectiveSeedPlan(4), false),
        activeMatches: []
      });
      const blocked = generated.rounds[0].matches[0];
      const result = resolveBracketAdvancements({
        topology: generated.topology,
        activeMatches: [active(blocked, {
          status,
          scoreAvailability,
          winnerTeamId: null,
          participantsFrozen: true
        })]
      });

      expect(result.rounds[0].matches[0]).toMatchObject({
        state: "blocked",
        blockingReason: reason,
        winnerTeamId: null
      });
      expect(result.blockedBracketMatchIds).toEqual([blocked.id]);
      expect(result.rounds[1].matches[0].state).toBe("waiting");
    }
  );

  it("updates an unstarted dependent in place but replaces a started dependent", () => {
    const afterSemifinals = resolvedFourTeamSemifinals();
    const final = afterSemifinals.rounds[1].matches[0];
    const source = afterSemifinals.rounds[0].matches[0];
    const previousWinner = requireWinner(source);
    const correctedWinner = otherParticipant(source, previousWinner);

    const unstartedImpact = analyzeBracketCorrectionImpact({
      current: afterSemifinals,
      correctedBracketMatchId: source.id,
      previousWinnerTeamId: previousWinner,
      correctedWinnerTeamId: correctedWinner
    });
    expect(unstartedImpact.requiresConfirmation).toBe(false);
    expect(unstartedImpact.actions).toEqual([
      expect.objectContaining({
        bracketMatchId: final.id,
        action: "update_unfrozen_match",
        preservedMatchId: final.matchInstance?.matchId
      })
    ]);

    const started = resolveBracketAdvancements({
      topology: afterSemifinals.topology,
      activeMatches: [
        ...completedInputs(afterSemifinals.rounds[0].matches),
        active(final, {
          status: "in_progress",
          scoreAvailability: "partial",
          winnerTeamId: null,
          participantsFrozen: true
        })
      ]
    });
    const firstImpact = analyzeBracketCorrectionImpact({
      current: started,
      correctedBracketMatchId: source.id,
      previousWinnerTeamId: previousWinner,
      correctedWinnerTeamId: correctedWinner
    });
    const retryImpact = analyzeBracketCorrectionImpact({
      current: started,
      correctedBracketMatchId: source.id,
      previousWinnerTeamId: previousWinner,
      correctedWinnerTeamId: correctedWinner
    });

    expect(firstImpact).toEqual(retryImpact);
    expect(firstImpact.requiresConfirmation).toBe(true);
    expect(firstImpact.actions[0]).toMatchObject({
      action: "replace_started_match",
      preservedMatchId: final.matchInstance?.matchId,
      replacement: {
        instanceNumber: 2,
        createWhenPlayable: false
      }
    });
    expect(firstImpact.actions[0].replacement?.matchId)
      .not.toBe(final.matchInstance?.matchId);
    expect(() => confirmBracketCorrectionImpact({
      impact: firstImpact,
      confirmationDigest: "0".repeat(64)
    })).toThrow("stale");
    expect(confirmBracketCorrectionImpact({
      impact: firstImpact,
      confirmationDigest: firstImpact.confirmationDigest
    }).confirmed).toBe(true);
  });

  it("plans a multi-round replacement cascade while preserving every old match ID", () => {
    const current = completedEightTeamPath();
    const quarterfinal = current.rounds[0].matches[0];
    const previousWinner = requireWinner(quarterfinal);
    const correctedWinner = otherParticipant(quarterfinal, previousWinner);
    const impact = analyzeBracketCorrectionImpact({
      current,
      correctedBracketMatchId: quarterfinal.id,
      previousWinnerTeamId: previousWinner,
      correctedWinnerTeamId: correctedWinner
    });

    expect(impact.actions.map((action) => action.action)).toEqual([
      "replace_started_match",
      "supersede_started_match_until_resolved"
    ]);
    expect(impact.actions.every((action) => action.preservedMatchId !== null))
      .toBe(true);
    expect(impact.actions[1].replacement).toMatchObject({
      instanceNumber: 2,
      participantTeamIds: null,
      createWhenPlayable: true
    });
  });

  it("clears an unstarted descendant when a resolved source is postponed", () => {
    const current = resolvedFourTeamSemifinals();
    const source = current.rounds[0].matches[0];
    const final = current.rounds[1].matches[0];
    const impact = analyzeBracketCorrectionImpact({
      current,
      correctedBracketMatchId: source.id,
      previousWinnerTeamId: requireWinner(source),
      correctedWinnerTeamId: null,
      correctedNoWinnerStatus: "postponed"
    });

    expect(impact).toMatchObject({
      correctedWinnerTeamId: null,
      correctedNoWinnerStatus: "postponed",
      winnerChanged: true,
      requiresConfirmation: false
    });
    expect(impact.actions).toEqual([
      expect.objectContaining({
        bracketMatchId: final.id,
        action: "clear_unfrozen_match_until_resolved",
        nextParticipantTeamIds: null,
        preservedMatchId: final.matchInstance?.matchId,
        replacement: null
      })
    ]);
  });

  it("supersedes one frozen descendant until a cancelled source is resolved again", () => {
    const afterSemifinals = resolvedFourTeamSemifinals();
    const source = afterSemifinals.rounds[0].matches[0];
    const final = afterSemifinals.rounds[1].matches[0];
    const current = resolveBracketAdvancements({
      topology: afterSemifinals.topology,
      activeMatches: [
        ...completedInputs(afterSemifinals.rounds[0].matches),
        active(final, {
          status: "in_progress",
          scoreAvailability: "partial",
          winnerTeamId: null,
          participantsFrozen: true
        })
      ]
    });
    const first = analyzeBracketCorrectionImpact({
      current,
      correctedBracketMatchId: source.id,
      previousWinnerTeamId: requireWinner(source),
      correctedWinnerTeamId: null,
      correctedNoWinnerStatus: "cancelled"
    });
    const retry = analyzeBracketCorrectionImpact({
      current,
      correctedBracketMatchId: source.id,
      previousWinnerTeamId: requireWinner(source),
      correctedWinnerTeamId: null,
      correctedNoWinnerStatus: "cancelled"
    });

    expect(retry).toEqual(first);
    expect(first.requiresConfirmation).toBe(true);
    expect(first.actions).toEqual([
      expect.objectContaining({
        bracketMatchId: final.id,
        action: "supersede_started_match_until_resolved",
        priorWinnerTeamId: null,
        nextWinnerTeamId: null,
        nextParticipantTeamIds: null,
        preservedMatchId: final.matchInstance?.matchId,
        replacement: {
          matchId: createStablePlayoffMatchInstanceId({
            tournamentId: tournamentId(),
            bracketMatchId: final.id,
            instanceNumber: 2
          }),
          instanceNumber: 2,
          participantTeamIds: null,
          createWhenPlayable: true
        }
      })
    ]);
  });

  it("supersedes every frozen descendant of a no-winner correction", () => {
    const current = completedEightTeamPath();
    const quarterfinal = current.rounds[0].matches[0];
    const semifinal = current.rounds[1].matches[0];
    const final = current.rounds[2].matches[0];
    const impact = analyzeBracketCorrectionImpact({
      current,
      correctedBracketMatchId: quarterfinal.id,
      previousWinnerTeamId: requireWinner(quarterfinal),
      correctedWinnerTeamId: null,
      correctedNoWinnerStatus: "cancelled"
    });

    expect(impact.requiresConfirmation).toBe(true);
    expect(impact.actions.map((action) => [
      action.bracketMatchId,
      action.action,
      action.replacement?.participantTeamIds,
      action.replacement?.createWhenPlayable
    ])).toEqual([
      [semifinal.id, "supersede_started_match_until_resolved", null, true],
      [final.id, "supersede_started_match_until_resolved", null, true]
    ]);
    expect(impact.actions.map((action) => action.replacement?.matchId)).toEqual([
      createStablePlayoffMatchInstanceId({
        tournamentId: tournamentId(),
        bracketMatchId: semifinal.id,
        instanceNumber: 2
      }),
      createStablePlayoffMatchInstanceId({
        tournamentId: tournamentId(),
        bracketMatchId: final.id,
        instanceNumber: 2
      })
    ]);
  });

  it("rejects a stale no-winner confirmation when the correction intent changes", () => {
    const current = completedEightTeamPath();
    const source = current.rounds[0].matches[0];
    const base = {
      current,
      correctedBracketMatchId: source.id,
      previousWinnerTeamId: requireWinner(source),
      correctedWinnerTeamId: null
    } as const;
    const cancelled = analyzeBracketCorrectionImpact({
      ...base,
      correctedNoWinnerStatus: "cancelled"
    });
    const postponed = analyzeBracketCorrectionImpact({
      ...base,
      correctedNoWinnerStatus: "postponed"
    });

    expect(cancelled.confirmationDigest).not.toBe(postponed.confirmationDigest);
    expect(() => confirmBracketCorrectionImpact({
      impact: postponed,
      confirmationDigest: cancelled.confirmationDigest
    })).toThrow("stale");
    expect(confirmBracketCorrectionImpact({
      impact: cancelled,
      confirmationDigest: cancelled.confirmationDigest
    })).toMatchObject({ confirmed: true, correctedNoWinnerStatus: "cancelled" });
  });
});

function topology(
  bracketSize: number,
  effectiveSeedPlan: EffectiveSeedPlan,
  allowByes: boolean
) {
  return generateMirroredBracketTopology({
    tournamentId: tournamentId(),
    rulesVersion: SINGLE_ELIMINATION_BRACKET_RULES_VERSION,
    bracketSize,
    allowByes,
    effectiveSeedPlan
  });
}

function effectiveSeedPlan(
  count: number,
  podForSeed: (seed: number) => PodId = (seed) => podId(Math.ceil(seed / 2))
): EffectiveSeedPlan {
  return {
    tournamentId: tournamentId(),
    seedCalculationId: stableUuid(1_001),
    seedCalculationInputDigest: "a".repeat(64),
    source: "calculated",
    overrideDigest: null,
    audit: null,
    rows: Array.from({ length: count }, (_, index) => ({
      teamId: teamId(index + 1),
      podId: podForSeed(index + 1),
      calculatedSeed: index + 1,
      effectiveSeed: index + 1
    })),
    changes: []
  };
}

function resolvedFourTeamSemifinals(): BracketResolutionPlan {
  const initial = resolveBracketAdvancements({
    topology: topology(4, effectiveSeedPlan(4), false),
    activeMatches: []
  });
  return resolveBracketAdvancements({
    topology: initial.topology,
    activeMatches: initial.rounds[0].matches.map((match) =>
      completed(match, requireFirstTeam(match))
    )
  });
}

function completedEightTeamPath(): BracketResolutionPlan {
  const initial = resolveBracketAdvancements({
    topology: topology(8, effectiveSeedPlan(8), false),
    activeMatches: []
  });
  const quarterfinals = initial.rounds[0].matches.map((match) =>
    completed(match, requireFirstTeam(match))
  );
  const afterQuarterfinals = resolveBracketAdvancements({
    topology: initial.topology,
    activeMatches: quarterfinals
  });
  const semifinals = afterQuarterfinals.rounds[1].matches.map((match) =>
    completed(match, requireFirstTeam(match))
  );
  const afterSemifinals = resolveBracketAdvancements({
    topology: initial.topology,
    activeMatches: [...quarterfinals, ...semifinals]
  });
  const final = afterSemifinals.rounds[2].matches[0];
  return resolveBracketAdvancements({
    topology: initial.topology,
    activeMatches: [
      ...quarterfinals,
      ...semifinals,
      active(final, {
        status: "in_progress",
        scoreAvailability: "partial",
        winnerTeamId: null,
        participantsFrozen: true
      })
    ]
  });
}

function completedInputs(
  matches: readonly BracketResolvedMatch[]
): readonly ActiveBracketMatchInput[] {
  return matches.map((match) => completed(match, requireWinner(match)));
}

function completed(
  match: BracketResolvedMatch,
  winnerTeamId: TournamentTeamId
): ActiveBracketMatchInput {
  return active(match, {
    status: "final",
    scoreAvailability: "complete",
    winnerTeamId,
    participantsFrozen: true
  });
}

function active(
  match: BracketResolvedMatch,
  state: Pick<
    ActiveBracketMatchInput,
    "status" | "scoreAvailability" | "winnerTeamId" | "participantsFrozen"
  >
): ActiveBracketMatchInput {
  if (match.matchInstance === null) {
    throw new Error("Expected an ordinary playoff match instance.");
  }
  return {
    bracketMatchId: match.id,
    matchId: match.matchInstance.matchId,
    instanceNumber: match.matchInstance.instanceNumber,
    participantTeamIds: match.matchInstance.participantTeamIds,
    ...state
  };
}

function requireFirstTeam(match: BracketResolvedMatch): TournamentTeamId {
  const state = match.slots[0].state;
  return state.type === "team"
    ? state.teamId
    : fail("Expected first resolved team.");
}

function requireWinner(match: BracketResolvedMatch): TournamentTeamId {
  return match.winnerTeamId ?? fail("Expected completed winner.");
}

function otherParticipant(
  match: BracketResolvedMatch,
  team: TournamentTeamId
): TournamentTeamId {
  const participants = match.matchInstance?.participantTeamIds;
  if (participants === undefined) {
    return fail("Expected ordinary match participants.");
  }
  return participants[0] === team ? participants[1] : participants[0];
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

function fail(message: string): never {
  throw new Error(message);
}
