import {
  parseStableUuid,
  PodId,
  TournamentId,
  TournamentTeamId
} from "../domain";
import {
  applyEffectiveSeedPermutationOverride,
  calculateGlobalQualifierSeeds,
  createCalculatedEffectiveSeedPlan
} from "./global-qualifier-seeding";
import {
  GlobalQualifierStandingInput,
  GLOBAL_QUALIFIER_SEEDING_RULES_VERSION
} from "./contracts";

describe("global qualifier seeding", () => {
  it("deterministically ranks the main 16-team field across shuffled input", () => {
    const qualifiers = Array.from({ length: 16 }, (_, index) =>
      qualifier(index + 1, {
        wins: 8 - Math.floor(index / 2),
        losses: Math.floor(index / 2),
        cupDifferential: 100 - index,
        makes: 80 - index,
        attempts: 100,
        shootingPercentage: (80 - index) / 100
      })
    );
    const first = calculateGlobalQualifierSeeds(calculationInput(
      qualifiers,
      seedCalculationId(1)
    ));
    const second = calculateGlobalQualifierSeeds(calculationInput(
      [...qualifiers].reverse(),
      seedCalculationId(1)
    ));

    expect(first.status).toBe("complete");
    expect(first.rows.map((row) => row.calculatedSeed)).toEqual(
      Array.from({ length: 16 }, (_, index) => index + 1)
    );
    expect(first.rows.map((row) => row.teamId)).toEqual(
      qualifiers.map((row) => row.teamId)
    );
    expect(second).toEqual(first);
  });

  it("ranks defined shooting percentage above null when prior metrics match", () => {
    const calculated = calculateGlobalQualifierSeeds(calculationInput([
      qualifier(1, { makes: 0, attempts: 0, shootingPercentage: null }),
      qualifier(2, { makes: 0, attempts: 1, shootingPercentage: 0 }),
      qualifier(3, {
        cupDifferential: -1,
        makes: 1,
        attempts: 1,
        shootingPercentage: 1
      })
    ], seedCalculationId(2)));

    expect(calculated.status).toBe("complete");
    expect(calculated.rows.map((row) => row.teamId)).toEqual([
      teamId(2),
      teamId(1),
      teamId(3)
    ]);
  });

  it("leaves exact ties unresolved until an exact audited permutation is supplied", () => {
    const qualifiers = [qualifier(1), qualifier(2, {
      makes: 2,
      attempts: 4
    }), qualifier(3, {
      cupDifferential: -1
    })];
    const pending = calculateGlobalQualifierSeeds(calculationInput(
      qualifiers,
      seedCalculationId(3)
    ));
    const tie = pending.tieGroups[0];

    expect(pending.status).toBe("unresolved_tie");
    expect(pending.rows.slice(0, 2).map((row) => row.calculatedSeed)).toEqual([
      null,
      null
    ]);
    expect(tie).toMatchObject({ seedRange: [1, 2], resolved: false });

    const resolved = calculateGlobalQualifierSeeds({
      ...calculationInput(qualifiers, seedCalculationId(3)),
      tieResolutions: [{
        resolutionId: stableUuid(8_001),
        tieGroupId: tie.tieGroupId,
        orderedTeamIds: [teamId(2), teamId(1)],
        reason: "Sanitized exact-tie decision",
        resolvedBy: "admin-1",
        resolvedAt: "2026-08-20T12:00:00.000Z"
      }]
    });

    expect(resolved.status).toBe("complete");
    expect(resolved.rows.map((row) => [row.teamId, row.calculatedSeed]))
      .toEqual([
        [teamId(2), 1],
        [teamId(1), 2],
        [teamId(3), 3]
      ]);
    expect(resolved.tieGroups[0]).toMatchObject({ resolved: true });
    expect(resolved.rows[0].administratorResolution).toMatchObject({
      order: 1,
      reason: "Sanitized exact-tie decision"
    });
  });

  it("rejects partial, foreign, duplicate, and cross-calculation tie resolutions", () => {
    const qualifiers = [qualifier(1), qualifier(2)];
    const first = calculateGlobalQualifierSeeds(calculationInput(
      qualifiers,
      seedCalculationId(4)
    ));
    const resolution = {
      resolutionId: stableUuid(8_002),
      tieGroupId: first.tieGroups[0].tieGroupId,
      orderedTeamIds: [teamId(1)] as readonly TournamentTeamId[],
      reason: "Sanitized decision",
      resolvedBy: "admin-1",
      resolvedAt: "2026-08-20T12:00:00.000Z"
    };

    expect(() => calculateGlobalQualifierSeeds({
      ...calculationInput(qualifiers, seedCalculationId(4)),
      tieResolutions: [resolution]
    })).toThrow("complete exact permutation");
    expect(() => calculateGlobalQualifierSeeds({
      ...calculationInput(qualifiers, seedCalculationId(4)),
      tieResolutions: [{
        ...resolution,
        orderedTeamIds: [teamId(1), teamId(3)]
      }]
    })).toThrow("only the tied teams");
    expect(() => calculateGlobalQualifierSeeds({
      ...calculationInput(qualifiers, seedCalculationId(4)),
      tieResolutions: [{
        ...resolution,
        orderedTeamIds: [teamId(1), teamId(1)]
      }]
    })).toThrow("complete exact permutation");
    expect(() => calculateGlobalQualifierSeeds({
      ...calculationInput(qualifiers, seedCalculationId(5)),
      tieResolutions: [{
        ...resolution,
        orderedTeamIds: [teamId(1), teamId(2)]
      }]
    })).toThrow("exact current tie group");
  });

  it("creates calculated seeds and audited complete-permutation overrides scoped to one calculation", () => {
    const qualifiers = [
      qualifier(1, { cupDifferential: 3 }),
      qualifier(2, { cupDifferential: 2 }),
      qualifier(3, { cupDifferential: 1 }),
      qualifier(4, { cupDifferential: 0 })
    ];
    const calculation = calculateGlobalQualifierSeeds(calculationInput(
      qualifiers,
      seedCalculationId(6)
    ));
    const calculatedPlan = createCalculatedEffectiveSeedPlan(calculation);
    const override = applyEffectiveSeedPermutationOverride({
      calculation,
      orderedTeamIds: [teamId(2), teamId(1), teamId(4), teamId(3)],
      audit: {
        overrideId: stableUuid(8_003),
        reason: "Sanitized official seed review",
        overriddenBy: "admin-1",
        overriddenAt: "2026-08-20T12:30:00.000Z"
      }
    });

    expect(calculatedPlan.source).toBe("calculated");
    expect(calculatedPlan.changes).toEqual([]);
    expect(override.source).toBe("administrator_override");
    expect(override.rows.map((row) => row.teamId)).toEqual([
      teamId(2), teamId(1), teamId(4), teamId(3)
    ]);
    expect(override.changes).toHaveLength(4);
    expect(override.overrideDigest).toMatch(/^[a-f0-9]{64}$/);

    expect(() => applyEffectiveSeedPermutationOverride({
      calculation,
      orderedTeamIds: [teamId(1), teamId(2), teamId(3)],
      audit: override.audit!
    })).toThrow("order every qualifier");
    expect(() => applyEffectiveSeedPermutationOverride({
      calculation,
      orderedTeamIds: [teamId(1), teamId(2), teamId(3), teamId(3)],
      audit: override.audit!
    })).toThrow("exact team permutation");
    expect(() => applyEffectiveSeedPermutationOverride({
      calculation,
      orderedTeamIds: [teamId(1), teamId(2), teamId(3), teamId(4)],
      audit: override.audit!
    })).toThrow("change at least one");
  });
});

function calculationInput(
  qualifiers: readonly GlobalQualifierStandingInput[],
  calculationId: string
) {
  return {
    tournamentId: tournamentId(),
    seedCalculationId: calculationId,
    rulesVersion: GLOBAL_QUALIFIER_SEEDING_RULES_VERSION,
    qualifiersPerPod: 2,
    qualifiers
  };
}

function qualifier(
  index: number,
  overrides: Partial<Omit<GlobalQualifierStandingInput, "teamId" | "podId">> = {}
): GlobalQualifierStandingInput {
  return {
    teamId: teamId(index),
    podId: podId(Math.ceil(index / 2)),
    podRank: index % 2 === 1 ? 1 : 2,
    wins: 3,
    losses: 0,
    cupDifferential: 0,
    makes: 1,
    attempts: 2,
    shootingPercentage: 0.5,
    ...overrides
  };
}

function tournamentId(): TournamentId {
  return parseStableUuid(stableUuid(1), "tournament");
}

function seedCalculationId(index: number): string {
  return stableUuid(1_000 + index);
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
