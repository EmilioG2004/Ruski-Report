import { isStableUuid } from "../domain";
import { createUuidV5 } from "../scheduling/uuid-v5";
import { canonicalSha256 } from "../workbook/canonical-json";
import {
  ApplyEffectiveSeedPermutationOverrideInput,
  AppliedGlobalQualifierTieResolution,
  CalculateGlobalQualifierSeedsInput,
  EffectiveSeedPlan,
  GlobalQualifierSeedCalculation,
  GlobalQualifierSeedRow,
  GlobalQualifierStandingInput,
  GlobalQualifierTieGroup,
  GlobalQualifierTieResolution,
  GLOBAL_QUALIFIER_SEEDING_RULES_VERSION,
  SeedingValidationIssue
} from "./contracts";
import { SeedingValidationError } from "./errors";

interface RankingGroup {
  readonly qualifiers: readonly GlobalQualifierStandingInput[];
  readonly startSeed: number;
  readonly endSeed: number;
  readonly tieGroupId?: string;
}

export function calculateGlobalQualifierSeeds(
  input: CalculateGlobalQualifierSeedsInput
): GlobalQualifierSeedCalculation {
  validateCalculationInput(input);
  const canonicalQualifiers = [...input.qualifiers].sort(compareIdentity);
  const inputDigest = canonicalSha256({
    tournamentId: input.tournamentId,
    seedCalculationId: input.seedCalculationId,
    rulesVersion: input.rulesVersion,
    qualifiersPerPod: input.qualifiersPerPod,
    qualifiers: canonicalQualifiers
  });
  const ranked = [...canonicalQualifiers].sort(compareStanding);
  const groups = createRankingGroups(input.seedCalculationId, ranked);
  const resolutionsByTieGroup = validateAndIndexTieResolutions(
    input.tieResolutions ?? [],
    groups
  );
  const rows: GlobalQualifierSeedRow[] = [];
  const tieGroups: GlobalQualifierTieGroup[] = [];

  for (const group of groups) {
    const resolution = group.tieGroupId === undefined
      ? undefined
      : resolutionsByTieGroup.get(group.tieGroupId);
    const ordered = resolution === undefined
      ? group.qualifiers
      : resolution.orderedTeamIds.map((teamId) => requireQualifier(group, teamId));
    ordered.forEach((qualifier, index) => {
      const resolvedOrder = resolution === undefined
        ? undefined
        : appliedResolution(resolution, index + 1);
      rows.push({
        ...qualifier,
        calculatedSeed: group.qualifiers.length === 1 || resolution !== undefined
          ? group.startSeed + index
          : null,
        seedRange: [group.startSeed, group.endSeed],
        ...(group.tieGroupId === undefined
          ? {}
          : { tieGroupId: group.tieGroupId }),
        ...(resolvedOrder === undefined
          ? {}
          : { administratorResolution: resolvedOrder })
      });
    });

    if (group.tieGroupId !== undefined) {
      const first = group.qualifiers[0];
      tieGroups.push({
        tieGroupId: group.tieGroupId,
        teamIds: group.qualifiers.map((qualifier) => qualifier.teamId),
        seedRange: [group.startSeed, group.endSeed],
        wins: first.wins,
        losses: first.losses,
        cupDifferential: first.cupDifferential,
        shootingPercentageNumerator: first.makes,
        shootingPercentageDenominator: first.attempts,
        shootingPercentage: first.shootingPercentage,
        resolved: resolution !== undefined,
        ...(resolution === undefined
          ? {}
          : { resolutionId: resolution.resolutionId })
      });
    }
  }

  return {
    tournamentId: input.tournamentId,
    seedCalculationId: input.seedCalculationId,
    rulesVersion: input.rulesVersion,
    inputDigest,
    status: rows.every((row) => row.calculatedSeed !== null)
      ? "complete"
      : "unresolved_tie",
    rows,
    tieGroups
  };
}

export function createCalculatedEffectiveSeedPlan(
  calculation: GlobalQualifierSeedCalculation
): EffectiveSeedPlan {
  const complete = requireCompleteCalculation(calculation);
  return {
    tournamentId: calculation.tournamentId,
    seedCalculationId: calculation.seedCalculationId,
    seedCalculationInputDigest: calculation.inputDigest,
    source: "calculated",
    overrideDigest: null,
    audit: null,
    rows: complete.map((row) => ({
      teamId: row.teamId,
      podId: row.podId,
      calculatedSeed: row.calculatedSeed,
      effectiveSeed: row.calculatedSeed
    })),
    changes: []
  };
}

export function applyEffectiveSeedPermutationOverride(
  input: ApplyEffectiveSeedPermutationOverrideInput
): EffectiveSeedPlan {
  const calculated = requireCompleteCalculation(input.calculation);
  validateAudit(input.audit);
  const byTeam = new Map(calculated.map((row) => [row.teamId, row]));
  if (input.orderedTeamIds.length !== calculated.length) {
    invalid("effective_seed_permutation_length", "An effective-seed override must order every qualifier.");
  }
  const seen = new Set<string>();
  input.orderedTeamIds.forEach((teamId, index) => {
    if (!byTeam.has(teamId)) {
      invalid(
        "effective_seed_unknown_team",
        `Effective seed ${index + 1} references a team outside this calculation.`
      );
    }
    if (seen.has(teamId)) {
      invalid(
        "effective_seed_duplicate_team",
        "An effective-seed override must be an exact team permutation."
      );
    }
    seen.add(teamId);
  });
  const rows = input.orderedTeamIds.map((teamId, index) => {
    const row = byTeam.get(teamId);
    if (row === undefined) {
      throw new Error("Validated effective seed lost its calculated row.");
    }
    return {
      teamId: row.teamId,
      podId: row.podId,
      calculatedSeed: row.calculatedSeed,
      effectiveSeed: index + 1
    };
  });
  const changes = rows
    .filter((row) => row.calculatedSeed !== row.effectiveSeed)
    .map((row) => ({
      teamId: row.teamId,
      previousSeed: row.calculatedSeed,
      newSeed: row.effectiveSeed
    }));
  if (changes.length === 0) {
    invalid(
      "effective_seed_override_unchanged",
      "An administrator override must change at least one effective seed."
    );
  }
  const overrideDigest = canonicalSha256({
    tournamentId: input.calculation.tournamentId,
    seedCalculationId: input.calculation.seedCalculationId,
    seedCalculationInputDigest: input.calculation.inputDigest,
    orderedTeamIds: input.orderedTeamIds,
    audit: input.audit
  });
  return {
    tournamentId: input.calculation.tournamentId,
    seedCalculationId: input.calculation.seedCalculationId,
    seedCalculationInputDigest: input.calculation.inputDigest,
    source: "administrator_override",
    overrideDigest,
    audit: input.audit,
    rows,
    changes
  };
}

function createRankingGroups(
  seedCalculationId: string,
  qualifiers: readonly GlobalQualifierStandingInput[]
): readonly RankingGroup[] {
  const groups: RankingGroup[] = [];
  for (let start = 0; start < qualifiers.length;) {
    let end = start + 1;
    while (end < qualifiers.length && compareStandingMetrics(
      qualifiers[start],
      qualifiers[end]
    ) === 0) {
      end += 1;
    }
    const tied = qualifiers.slice(start, end).sort(compareIdentity);
    groups.push({
      qualifiers: tied,
      startSeed: start + 1,
      endSeed: end,
      ...(tied.length === 1
        ? {}
        : {
          tieGroupId: createUuidV5(
            seedCalculationId,
            `global-qualifier-tie|${tied.map((row) => row.teamId).join("|")}`
          )
        })
    });
    start = end;
  }
  return groups;
}

function validateAndIndexTieResolutions(
  resolutions: readonly GlobalQualifierTieResolution[],
  groups: readonly RankingGroup[]
): ReadonlyMap<string, GlobalQualifierTieResolution> {
  const groupsById = new Map(
    groups
      .filter((group): group is RankingGroup & { readonly tieGroupId: string } =>
        group.tieGroupId !== undefined
      )
      .map((group) => [group.tieGroupId, group])
  );
  const indexed = new Map<string, GlobalQualifierTieResolution>();
  const resolutionIds = new Set<string>();
  for (const resolution of resolutions) {
    if (!isStableUuid(resolution.resolutionId)) {
      invalid("tie_resolution_id", "A tie resolution ID must be a non-nil UUID.");
    }
    if (resolutionIds.has(resolution.resolutionId)) {
      invalid("tie_resolution_duplicate_id", "Tie resolution IDs must be unique.");
    }
    resolutionIds.add(resolution.resolutionId);
    const group = groupsById.get(resolution.tieGroupId);
    if (group === undefined) {
      invalid("tie_resolution_unknown_group", "A tie resolution must reference an exact current tie group.");
    }
    if (indexed.has(resolution.tieGroupId)) {
      invalid("tie_resolution_duplicate_group", "A tie group may have only one resolution.");
    }
    validateAuditText(resolution.reason, "tie_resolution_reason", "Tie resolution reason");
    validateAuditText(resolution.resolvedBy, "tie_resolution_actor", "Tie resolution actor");
    validateIsoDateTime(resolution.resolvedAt, "tie_resolution_time", "Tie resolution time");
    validateExactPermutation(
      resolution.orderedTeamIds,
      group.qualifiers.map((qualifier) => qualifier.teamId),
      "tie resolution"
    );
    indexed.set(resolution.tieGroupId, resolution);
  }
  return indexed;
}

function validateCalculationInput(input: CalculateGlobalQualifierSeedsInput): void {
  if (!isStableUuid(input.tournamentId)) {
    invalid("tournament_id", "Tournament ID must be a non-nil UUID.");
  }
  if (!isStableUuid(input.seedCalculationId)) {
    invalid("seed_calculation_id", "Seed calculation ID must be a non-nil UUID.");
  }
  if (input.rulesVersion !== GLOBAL_QUALIFIER_SEEDING_RULES_VERSION) {
    invalid("rules_version", `Global qualifier seeding requires rules version ${GLOBAL_QUALIFIER_SEEDING_RULES_VERSION}.`);
  }
  if (!Number.isSafeInteger(input.qualifiersPerPod) ||
      input.qualifiersPerPod < 1) {
    invalid("qualifiers_per_pod", "Qualifiers per pod must be a positive integer.");
  }
  if (input.qualifiers.length < 1) {
    invalid("qualifiers_empty", "Global qualifier seeding requires at least one qualifier.");
  }
  const teamIds = new Set<string>();
  for (const [index, qualifier] of input.qualifiers.entries()) {
    if (!isStableUuid(qualifier.teamId) || !isStableUuid(qualifier.podId)) {
      invalid("qualifier_identity", `Qualifier ${index + 1} has an invalid team or pod ID.`);
    }
    if (teamIds.has(qualifier.teamId)) {
      invalid("qualifier_duplicate_team", "Each team may qualify only once.");
    }
    teamIds.add(qualifier.teamId);
    requireNonNegativeInteger(qualifier.podRank, "pod rank", index, true);
    if (qualifier.podRank > input.qualifiersPerPod) {
      invalid("qualifier_pod_rank", `Qualifier ${index + 1} is below the qualifying pod ranks.`);
    }
    requireNonNegativeInteger(qualifier.wins, "wins", index);
    requireNonNegativeInteger(qualifier.losses, "losses", index);
    if (!Number.isSafeInteger(qualifier.cupDifferential)) {
      invalid("qualifier_cup_differential", `Qualifier ${index + 1} cup differential must be an integer.`);
    }
    requireNonNegativeInteger(qualifier.makes, "makes", index);
    requireNonNegativeInteger(qualifier.attempts, "attempts", index);
    if (qualifier.makes > qualifier.attempts) {
      invalid("qualifier_attempts", `Qualifier ${index + 1} makes cannot exceed attempts.`);
    }
    if (qualifier.shootingPercentage !== null &&
        (!Number.isFinite(qualifier.shootingPercentage) ||
          qualifier.shootingPercentage < 0 || qualifier.shootingPercentage > 1)) {
      invalid("qualifier_shooting_percentage", `Qualifier ${index + 1} shooting percentage must be null or between zero and one.`);
    }
    if ((qualifier.attempts === 0) !== (qualifier.shootingPercentage === null) ||
        (qualifier.attempts > 0 && qualifier.shootingPercentage !== null &&
          Math.abs(
            qualifier.shootingPercentage - qualifier.makes / qualifier.attempts
          ) > Number.EPSILON * 4)) {
      invalid("qualifier_shooting_percentage", `Qualifier ${index + 1} shooting percentage must match makes and attempts.`);
    }
  }
}

function compareStanding(
  left: GlobalQualifierStandingInput,
  right: GlobalQualifierStandingInput
): number {
  return compareStandingMetrics(left, right) || compareIdentity(left, right);
}

function compareStandingMetrics(
  left: GlobalQualifierStandingInput,
  right: GlobalQualifierStandingInput
): number {
  return right.wins - left.wins ||
    left.losses - right.losses ||
    right.cupDifferential - left.cupDifferential ||
    compareShootingPercentageDescending(left, right);
}

function compareShootingPercentageDescending(
  left: GlobalQualifierStandingInput,
  right: GlobalQualifierStandingInput
): number {
  if (left.attempts === 0 && right.attempts === 0) {
    return 0;
  }
  if (left.attempts === 0) {
    return 1;
  }
  if (right.attempts === 0) {
    return -1;
  }
  const leftCross = BigInt(left.makes) * BigInt(right.attempts);
  const rightCross = BigInt(right.makes) * BigInt(left.attempts);
  return leftCross === rightCross ? 0 : leftCross > rightCross ? -1 : 1;
}

function compareIdentity(
  left: GlobalQualifierStandingInput,
  right: GlobalQualifierStandingInput
): number {
  return left.teamId.localeCompare(right.teamId);
}

function appliedResolution(
  resolution: GlobalQualifierTieResolution,
  order: number
): AppliedGlobalQualifierTieResolution {
  return {
    resolutionId: resolution.resolutionId,
    order,
    reason: resolution.reason,
    resolvedBy: resolution.resolvedBy,
    resolvedAt: resolution.resolvedAt
  };
}

function requireQualifier(
  group: RankingGroup,
  teamId: string
): GlobalQualifierStandingInput {
  const qualifier = group.qualifiers.find((candidate) => candidate.teamId === teamId);
  if (qualifier === undefined) {
    throw new Error("Validated tie resolution lost its qualifier.");
  }
  return qualifier;
}

function requireCompleteCalculation(
  calculation: GlobalQualifierSeedCalculation
): ReadonlyArray<GlobalQualifierSeedRow & { readonly calculatedSeed: number }> {
  if (!isStableUuid(calculation.tournamentId) ||
      !isStableUuid(calculation.seedCalculationId) ||
      !/^[a-f0-9]{64}$/.test(calculation.inputDigest) ||
      calculation.rulesVersion !== GLOBAL_QUALIFIER_SEEDING_RULES_VERSION) {
    invalid("seed_calculation_identity", "Seed calculation identity, digest, or rules version is invalid.");
  }
  if (calculation.status !== "complete" ||
      calculation.rows.some((row) => row.calculatedSeed === null)) {
    invalid("seed_calculation_incomplete", "Effective seeds require a complete global seed calculation.");
  }
  const rows = calculation.rows as ReadonlyArray<GlobalQualifierSeedRow & {
    readonly calculatedSeed: number;
  }>;
  const teamIds = new Set<string>();
  for (const row of rows) {
    if (!isStableUuid(row.teamId) || !isStableUuid(row.podId) ||
        teamIds.has(row.teamId)) {
      invalid("calculated_seed_team", "Calculated seed teams must have unique stable identities.");
    }
    teamIds.add(row.teamId);
  }
  const seeds = [...rows].map((row) => row.calculatedSeed).sort((a, b) => a - b);
  seeds.forEach((seed, index) => {
    if (seed !== index + 1) {
      invalid("calculated_seed_sequence", "Calculated seeds must be unique and contiguous from one.");
    }
  });
  return [...rows].sort((left, right) => left.calculatedSeed - right.calculatedSeed);
}

function validateAudit(audit: ApplyEffectiveSeedPermutationOverrideInput["audit"]): void {
  if (!isStableUuid(audit.overrideId)) {
    invalid("override_id", "Seed override ID must be a non-nil UUID.");
  }
  validateAuditText(audit.reason, "override_reason", "Seed override reason");
  validateAuditText(audit.overriddenBy, "override_actor", "Seed override actor");
  validateIsoDateTime(audit.overriddenAt, "override_time", "Seed override time");
}

function validateExactPermutation(
  actual: readonly string[],
  expected: readonly string[],
  label: string
): void {
  if (actual.length !== expected.length || new Set(actual).size !== actual.length) {
    invalid("invalid_permutation", `The ${label} must be a complete exact permutation.`);
  }
  const expectedSet = new Set(expected);
  if (actual.some((value) => !expectedSet.has(value))) {
    invalid("invalid_permutation", `The ${label} must contain only the tied teams.`);
  }
}

function requireNonNegativeInteger(
  value: number,
  label: string,
  index: number,
  positive = false
): void {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    invalid("qualifier_integer", `Qualifier ${index + 1} ${label} is invalid.`);
  }
}

function validateAuditText(value: string, code: string, label: string): void {
  if (value.trim().length === 0) {
    invalid(code, `${label} cannot be blank.`);
  }
}

function validateIsoDateTime(value: string, code: string, label: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    invalid(code, `${label} must be an ISO-8601 date-time.`);
  }
}

function invalid(code: string, message: string, path?: string): never {
  const issue: SeedingValidationIssue = { code, message, ...(path === undefined ? {} : { path }) };
  throw new SeedingValidationError([issue]);
}
