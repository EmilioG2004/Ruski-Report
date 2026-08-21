import { isStableUuid, TournamentTeamId } from "../domain";
import {
  AppliedPodStandingTieResolution,
  CalculatePodStandingsInput,
  PodStandingBlockingReason,
  PodStandingCalculation,
  PodStandingCalculationStatus,
  PodStandingMatchCalculationInput,
  PodStandingMatchInput,
  PodStandingMatchTeamInput,
  PodStandingRow,
  PodStandingsValidationIssue,
  PodStandingTieGroup,
  PodStandingTieResolution
} from "./contracts";
import { standingsDigest } from "./standings-digest";

interface MutableStandingRow {
  readonly teamId: TournamentTeamId;
  readonly initialSeed: number;
  wins: number;
  losses: number;
  cupDifferential: number;
  makes: number;
  attempts: number;
}

interface RankedGroup {
  readonly rows: readonly MutableStandingRow[];
  readonly tieGroupId?: string;
  readonly resolution?: PodStandingTieResolution;
}

interface MatchEvaluation {
  readonly calculationInput: PodStandingMatchCalculationInput;
  readonly apply?: () => void;
}

export class PodStandingsValidationError extends Error {
  constructor(readonly issues: readonly PodStandingsValidationIssue[]) {
    super("Pod standings input is invalid.");
    this.name = "PodStandingsValidationError";
  }
}

export function calculatePodStandings(
  input: CalculatePodStandingsInput
): PodStandingCalculation {
  const issues = validateInput(input);
  if (issues.length > 0) {
    throw new PodStandingsValidationError(issues);
  }

  const rowsByTeamId = new Map(
    input.teams.map((team): [TournamentTeamId, MutableStandingRow] => [
      team.teamId,
      {
        teamId: team.teamId,
        initialSeed: team.initialSeed,
        wins: 0,
        losses: 0,
        cupDifferential: 0,
        makes: 0,
        attempts: 0
      }
    ])
  );
  const evaluations = [...input.matches]
    .sort((left, right) => left.matchId.localeCompare(right.matchId))
    .map((match) => evaluateMatch(match, rowsByTeamId));
  for (const evaluation of evaluations) {
    evaluation.apply?.();
  }

  const baseGroups = groupRows(
    [...rowsByTeamId.values()].sort(compareStandingRows),
    input
  );
  const resolvedGroups = applyTieResolutions(
    baseGroups,
    input.tieResolutions ?? []
  );
  const blockingMatchIds = evaluations.flatMap((evaluation) =>
    evaluation.calculationInput.disposition === "blocking"
      ? [evaluation.calculationInput.matchId]
      : []
  );
  const hasUnresolvedTie = resolvedGroups.some((group) =>
    group.rows.length > 1 && group.resolution === undefined
  );
  const status: PodStandingCalculationStatus = blockingMatchIds.length > 0
    ? "provisional"
    : hasUnresolvedTie ? "unresolved_tie" : "finalizable";
  const rows = materializeRows(resolvedGroups, input.qualifiersPerPod, status);
  const matchInputs = evaluations.map((evaluation) => evaluation.calculationInput);
  const cancelledMatchCount = matchInputs.filter((match) =>
    match.disposition === "excluded_cancelled"
  ).length;
  const resolvedRequiredMatchCount = matchInputs.filter((match) =>
    match.disposition === "included_final" ||
    match.disposition === "included_forfeit"
  ).length;

  return {
    inputDigest: calculateInputDigest(input),
    rulesVersion: input.rulesVersion,
    status,
    rows,
    tieGroups: materializeTieGroups(resolvedGroups),
    matchInputs,
    scheduledMatchCount: matchInputs.length,
    requiredMatchCount: matchInputs.length - cancelledMatchCount,
    resolvedRequiredMatchCount,
    cancelledMatchCount,
    blockingMatchIds
  };
}

function evaluateMatch(
  match: PodStandingMatchInput,
  rows: ReadonlyMap<TournamentTeamId, MutableStandingRow>
): MatchEvaluation {
  const shared = {
    matchId: match.matchId,
    revisionId: match.revisionId ?? null,
    statisticRunId: match.statisticRunId ?? null,
    statisticInputDigest: match.statisticInputDigest ?? null,
    status: match.status,
    scoreAvailability: match.scoreAvailability
  };
  if (match.status === "cancelled") {
    return {
      calculationInput: { ...shared, disposition: "excluded_cancelled" }
    };
  }
  if (match.status === "forfeited") {
    const winner = match.teams.find((team) => team.result === "win");
    const loser = match.teams.find((team) => team.result === "forfeited");
    return {
      calculationInput: { ...shared, disposition: "included_forfeit" },
      apply: () => {
        requiredRow(rows, winner?.teamId).wins += 1;
        requiredRow(rows, loser?.teamId).losses += 1;
      }
    };
  }
  if (match.status === "final" && match.scoreAvailability === "complete") {
    return {
      calculationInput: { ...shared, disposition: "included_final" },
      apply: () => {
        for (const team of match.teams) {
          const row = requiredRow(rows, team.teamId);
          row.wins += team.result === "win" ? 1 : 0;
          row.losses += team.result === "loss" ? 1 : 0;
          row.cupDifferential += team.cupsScored - team.cupsAgainst;
          row.makes += team.makes;
          row.attempts += team.attempts;
        }
      }
    };
  }
  const blockingReason = match.status === "final"
    ? "final_unrecorded"
    : match.status as PodStandingBlockingReason;
  return {
    calculationInput: {
      ...shared,
      disposition: "blocking",
      blockingReason
    }
  };
}

function requiredRow(
  rows: ReadonlyMap<TournamentTeamId, MutableStandingRow>,
  teamId: TournamentTeamId | undefined
): MutableStandingRow {
  const row = teamId === undefined ? undefined : rows.get(teamId);
  if (row === undefined) {
    throw new Error("Validated standings team is missing from its pod.");
  }
  return row;
}

function groupRows(
  orderedRows: readonly MutableStandingRow[],
  input: Pick<CalculatePodStandingsInput, "tournamentId" | "podId" | "rulesVersion">
): RankedGroup[] {
  const groups: MutableStandingRow[][] = [];
  for (const row of orderedRows) {
    const group = groups.at(-1);
    if (group === undefined || !sameStandingMetrics(group[0], row)) {
      groups.push([row]);
    } else {
      group.push(row);
    }
  }
  return groups.map((group) => {
    if (group.length === 1) {
      return { rows: group };
    }
    const first = group[0];
    const fraction = reducedShootingFraction(first);
    return {
      rows: [...group].sort((left, right) => left.teamId.localeCompare(right.teamId)),
      tieGroupId: standingsDigest({
        contract: "pod-standing-tie-v1",
        tournamentId: input.tournamentId,
        podId: input.podId,
        rulesVersion: input.rulesVersion,
        teamIds: group.map((row) => row.teamId).sort(),
        wins: first.wins,
        losses: first.losses,
        cupDifferential: first.cupDifferential,
        shootingPercentageNumerator: fraction.numerator,
        shootingPercentageDenominator: fraction.denominator
      })
    };
  });
}

function applyTieResolutions(
  groups: readonly RankedGroup[],
  resolutions: readonly PodStandingTieResolution[]
): RankedGroup[] {
  const issues: PodStandingsValidationIssue[] = [];
  const resolutionByGroup = new Map<string, PodStandingTieResolution>();
  const resolutionIds = new Set<string>();
  for (const [index, original] of resolutions.entries()) {
    const resolution = normalizeResolution(original);
    const path = `tieResolutions[${index}]`;
    validateResolutionIdentity(resolution, path, issues);
    if (resolutionIds.has(resolution.resolutionId)) {
      issue(issues, "DUPLICATE_TIE_RESOLUTION_ID", "Tie resolution identity must be unique.", path);
    }
    if (resolutionByGroup.has(resolution.tieGroupId)) {
      issue(issues, "DUPLICATE_TIE_GROUP_RESOLUTION", "A tie group may have only one resolution.", path);
    }
    resolutionIds.add(resolution.resolutionId);
    resolutionByGroup.set(resolution.tieGroupId, resolution);
  }

  const knownGroups = new Set(groups.flatMap((group) =>
    group.tieGroupId === undefined ? [] : [group.tieGroupId]
  ));
  for (const [tieGroupId] of resolutionByGroup) {
    if (!knownGroups.has(tieGroupId)) {
      issue(
        issues,
        "STALE_TIE_RESOLUTION",
        "Tie resolution does not match a current exact tie group.",
        "tieResolutions"
      );
    }
  }

  const resolved = groups.map((group): RankedGroup => {
    if (group.tieGroupId === undefined) {
      return group;
    }
    const resolution = resolutionByGroup.get(group.tieGroupId);
    if (resolution === undefined) {
      return group;
    }
    const expected = group.rows.map((row) => row.teamId).sort();
    const supplied = [...resolution.orderedTeamIds].sort();
    if (!equalStrings(expected, supplied) ||
        new Set(resolution.orderedTeamIds).size !== resolution.orderedTeamIds.length) {
      issue(
        issues,
        "INEXACT_TIE_RESOLUTION",
        "Tie resolution must order every tied team exactly once.",
        `tieResolutions.${resolution.resolutionId}`
      );
      return group;
    }
    const rowByTeamId = new Map(group.rows.map((row) => [row.teamId, row]));
    return {
      tieGroupId: group.tieGroupId,
      resolution,
      rows: resolution.orderedTeamIds.map((teamId) => requiredRow(rowByTeamId, teamId))
    };
  });
  if (issues.length > 0) {
    throw new PodStandingsValidationError(issues);
  }
  return resolved;
}

function materializeRows(
  groups: readonly RankedGroup[],
  qualifiersPerPod: number,
  status: PodStandingCalculationStatus
): PodStandingRow[] {
  let displayOrder = 1;
  const rows: PodStandingRow[] = [];
  for (const group of groups) {
    const unresolved = group.rows.length > 1 && group.resolution === undefined;
    for (const [groupIndex, source] of group.rows.entries()) {
      const rank = unresolved ? null : displayOrder;
      const administratorResolution = group.resolution === undefined
        ? undefined
        : appliedResolution(group.resolution, groupIndex + 1);
      rows.push({
        teamId: source.teamId,
        initialSeed: source.initialSeed,
        displayOrder,
        rank,
        wins: source.wins,
        losses: source.losses,
        cupDifferential: source.cupDifferential,
        makes: source.makes,
        attempts: source.attempts,
        shootingPercentage: percentage(source),
        qualified: status === "finalizable" &&
          rank !== null && rank <= qualifiersPerPod,
        ...(group.tieGroupId === undefined
          ? {}
          : { tieGroupId: group.tieGroupId }),
        ...(administratorResolution === undefined
          ? {}
          : { administratorResolution })
      });
      displayOrder += 1;
    }
  }
  return rows;
}

function materializeTieGroups(groups: readonly RankedGroup[]): PodStandingTieGroup[] {
  return groups.flatMap((group) => {
    if (group.tieGroupId === undefined) {
      return [];
    }
    const first = group.rows[0];
    const fraction = reducedShootingFraction(first);
    return [{
      tieGroupId: group.tieGroupId,
      teamIds: group.rows.map((row) => row.teamId),
      wins: first.wins,
      losses: first.losses,
      cupDifferential: first.cupDifferential,
      shootingPercentageNumerator: fraction.numerator,
      shootingPercentageDenominator: fraction.denominator,
      shootingPercentage: percentage(first),
      resolved: group.resolution !== undefined,
      ...(group.resolution === undefined
        ? {}
        : { resolutionId: group.resolution.resolutionId })
    }];
  });
}

function appliedResolution(
  resolution: PodStandingTieResolution,
  order: number
): AppliedPodStandingTieResolution {
  return {
    resolutionId: resolution.resolutionId,
    order,
    reason: resolution.reason,
    resolvedBy: resolution.resolvedBy,
    resolvedAt: resolution.resolvedAt
  };
}

function compareStandingRows(
  left: MutableStandingRow,
  right: MutableStandingRow
): number {
  return right.wins - left.wins ||
    left.losses - right.losses ||
    right.cupDifferential - left.cupDifferential ||
    compareShootingPercentage(left, right) ||
    left.teamId.localeCompare(right.teamId);
}

function sameStandingMetrics(
  left: MutableStandingRow,
  right: MutableStandingRow
): boolean {
  return left.wins === right.wins &&
    left.losses === right.losses &&
    left.cupDifferential === right.cupDifferential &&
    compareShootingPercentage(left, right) === 0;
}

function compareShootingPercentage(
  left: Pick<MutableStandingRow, "makes" | "attempts">,
  right: Pick<MutableStandingRow, "makes" | "attempts">
): number {
  if (left.attempts === 0 || right.attempts === 0) {
    if (left.attempts === right.attempts) {
      return 0;
    }
    return left.attempts === 0 ? 1 : -1;
  }
  const leftProduct = BigInt(left.makes) * BigInt(right.attempts);
  const rightProduct = BigInt(right.makes) * BigInt(left.attempts);
  return leftProduct === rightProduct ? 0 : leftProduct > rightProduct ? -1 : 1;
}

function percentage(row: Pick<MutableStandingRow, "makes" | "attempts">): number | null {
  return row.attempts === 0 ? null : row.makes / row.attempts;
}

function reducedShootingFraction(
  row: Pick<MutableStandingRow, "makes" | "attempts">
): { numerator: number; denominator: number } {
  if (row.attempts === 0) {
    return { numerator: 0, denominator: 0 };
  }
  const divisor = greatestCommonDivisor(row.makes, row.attempts);
  return {
    numerator: row.makes / divisor,
    denominator: row.attempts / divisor
  };
}

function greatestCommonDivisor(left: number, right: number): number {
  let first = left;
  let second = right;
  while (second !== 0) {
    [first, second] = [second, first % second];
  }
  return first === 0 ? 1 : first;
}

function calculateInputDigest(input: CalculatePodStandingsInput): string {
  return standingsDigest({
    contract: "pod-standings-calculation-v1",
    tournamentId: input.tournamentId,
    podId: input.podId,
    rulesVersion: input.rulesVersion,
    gamesPerPair: input.gamesPerPair,
    qualifiersPerPod: input.qualifiersPerPod,
    teams: [...input.teams]
      .sort((left, right) => left.teamId.localeCompare(right.teamId)),
    matches: [...input.matches]
      .sort((left, right) => left.matchId.localeCompare(right.matchId))
      .map((match) => ({
        ...match,
        revisionId: match.revisionId ?? null,
        statisticRunId: match.statisticRunId ?? null,
        statisticInputDigest: match.statisticInputDigest ?? null,
        teams: [...match.teams]
          .sort((left, right) => left.teamId.localeCompare(right.teamId))
      })),
    tieResolutions: [...(input.tieResolutions ?? [])]
      .map(normalizeResolution)
      .sort((left, right) => left.tieGroupId.localeCompare(right.tieGroupId))
  });
}

function validateInput(input: CalculatePodStandingsInput): PodStandingsValidationIssue[] {
  const issues: PodStandingsValidationIssue[] = [];
  if (!isStableUuid(input.tournamentId)) {
    issue(issues, "INVALID_TOURNAMENT_ID", "Tournament identity must be a stable UUID.", "tournamentId");
  }
  if (!isStableUuid(input.podId)) {
    issue(issues, "INVALID_POD_ID", "Pod identity must be a stable UUID.", "podId");
  }
  if (!positiveInteger(input.rulesVersion)) {
    issue(issues, "INVALID_RULES_VERSION", "Standings rules version must be positive.", "rulesVersion");
  }
  if (!positiveInteger(input.gamesPerPair)) {
    issue(issues, "INVALID_GAMES_PER_PAIR", "Games per pair must be positive.", "gamesPerPair");
  }
  if (!positiveInteger(input.qualifiersPerPod) ||
      input.qualifiersPerPod > input.teams.length) {
    issue(issues, "INVALID_QUALIFIER_COUNT", "Qualifier count must fit the pod.", "qualifiersPerPod");
  }
  if (input.teams.length < 2) {
    issue(issues, "POD_TOO_SMALL", "Pod standings require at least two teams.", "teams");
  }
  const teamIds = new Set<string>();
  const seeds = new Set<number>();
  input.teams.forEach((team, index) => {
    if (!isStableUuid(team.teamId) || teamIds.has(team.teamId)) {
      issue(issues, "INVALID_POD_TEAM", "Pod team identities must be unique stable UUIDs.", `teams[${index}]`);
    }
    if (!positiveInteger(team.initialSeed) || seeds.has(team.initialSeed)) {
      issue(issues, "INVALID_INITIAL_SEED", "Initial pod seeds must be unique positive integers.", `teams[${index}].initialSeed`);
    }
    teamIds.add(team.teamId);
    seeds.add(team.initialSeed);
  });
  if ([...seeds].sort((left, right) => left - right)
    .some((seed, index) => seed !== index + 1)) {
    issue(issues, "NONCONTIGUOUS_INITIAL_SEEDS", "Initial pod seeds must be contiguous.", "teams");
  }
  const matchIds = new Set<string>();
  const revisionIds = new Set<string>();
  input.matches.forEach((match, index) => {
    validateMatch(match, index, teamIds, issues);
    if (matchIds.has(match.matchId)) {
      issue(issues, "DUPLICATE_MATCH", "A pod calculation may include each match once.", `matches[${index}].matchId`);
    }
    if (match.revisionId !== undefined && revisionIds.has(match.revisionId)) {
      issue(issues, "DUPLICATE_ACTIVE_REVISION", "An active revision may belong to only one match input.", `matches[${index}].revisionId`);
    }
    matchIds.add(match.matchId);
    if (match.revisionId !== undefined) {
      revisionIds.add(match.revisionId);
    }
  });
  validateCompleteSchedule(input, issues);
  return issues;
}

function validateCompleteSchedule(
  input: CalculatePodStandingsInput,
  issues: PodStandingsValidationIssue[]
): void {
  if (!positiveInteger(input.gamesPerPair) || input.teams.length < 2) {
    return;
  }
  const expectedCount =
    input.teams.length * (input.teams.length - 1) / 2 * input.gamesPerPair;
  if (input.matches.length !== expectedCount) {
    issue(
      issues,
      "INCOMPLETE_POD_SCHEDULE",
      `Pod standings require exactly ${expectedCount} scheduled match identities.`,
      "matches"
    );
  }
  const pairCounts = new Map<string, number>();
  for (const match of input.matches) {
    if (match.teams[0].teamId === match.teams[1].teamId) {
      continue;
    }
    const key = [match.teams[0].teamId, match.teams[1].teamId].sort().join(":");
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  const teams = [...input.teams].sort((left, right) =>
    left.teamId.localeCompare(right.teamId)
  );
  for (let leftIndex = 0; leftIndex < teams.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < teams.length; rightIndex += 1) {
      const key = `${teams[leftIndex].teamId}:${teams[rightIndex].teamId}`;
      if ((pairCounts.get(key) ?? 0) !== input.gamesPerPair) {
        issue(
          issues,
          "INVALID_PAIR_MULTIPLICITY",
          "Every unordered pod-team pair must occur exactly gamesPerPair times.",
          "matches"
        );
      }
    }
  }
}

function validateMatch(
  match: PodStandingMatchInput,
  index: number,
  podTeamIds: ReadonlySet<string>,
  issues: PodStandingsValidationIssue[]
): void {
  const path = `matches[${index}]`;
  if (!isStableUuid(match.matchId)) {
    issue(issues, "INVALID_MATCH_ID", "Match identity must be a stable UUID.", `${path}.matchId`);
  }
  const hasRevision = match.revisionId !== undefined;
  if (hasRevision && !isStableUuid(match.revisionId as string)) {
    issue(issues, "INVALID_REVISION_ID", "Revision identity must be a stable UUID.", `${path}.revisionId`);
  }
  if (!hasRevision && match.status !== "scheduled") {
    issue(issues, "ACTIVE_REVISION_REQUIRED", "Resolved or active matches require an active revision.", `${path}.revisionId`);
  }
  if (hasRevision) {
    if (match.statisticRunId === undefined || !isStableUuid(match.statisticRunId)) {
      issue(issues, "STATISTIC_RUN_REQUIRED", "An active revision requires its canonical statistic run.", `${path}.statisticRunId`);
    }
    if (match.statisticInputDigest === undefined ||
        !/^[a-f0-9]{64}$/.test(match.statisticInputDigest)) {
      issue(issues, "STATISTIC_DIGEST_REQUIRED", "An active revision requires its canonical statistic input digest.", `${path}.statisticInputDigest`);
    }
  } else if (match.statisticRunId !== undefined ||
      match.statisticInputDigest !== undefined) {
    issue(issues, "ORPHANED_STATISTIC_INPUT", "Statistic provenance requires an active revision.", path);
  }
  validateStatusAvailability(match, path, issues);
  if (match.teams[0].teamId === match.teams[1].teamId) {
    issue(issues, "DUPLICATE_MATCH_TEAM", "A match requires two distinct teams.", `${path}.teams`);
  }
  match.teams.forEach((team, teamIndex) => {
    if (!podTeamIds.has(team.teamId)) {
      issue(issues, "MATCH_TEAM_OUTSIDE_POD", "Every match team must belong to the calculation pod.", `${path}.teams[${teamIndex}].teamId`);
    }
    validateTeamNumbers(team, `${path}.teams[${teamIndex}]`, issues);
  });
  validateResultsAndScores(match, path, issues);
}

function validateStatusAvailability(
  match: PodStandingMatchInput,
  path: string,
  issues: PodStandingsValidationIssue[]
): void {
  const valid =
    ((match.status === "scheduled" || match.status === "postponed") &&
      match.scoreAvailability === "not_started") ||
    (match.status === "in_progress" && match.scoreAvailability === "partial") ||
    (match.status === "final" &&
      (match.scoreAvailability === "complete" ||
       match.scoreAvailability === "unrecorded")) ||
    ((match.status === "forfeited" || match.status === "cancelled") &&
      match.scoreAvailability === "not_applicable");
  if (!valid) {
    issue(issues, "INVALID_STATUS_AVAILABILITY", "Match status and score availability are inconsistent.", path);
  }
}

function validateTeamNumbers(
  team: PodStandingMatchTeamInput,
  path: string,
  issues: PodStandingsValidationIssue[]
): void {
  if (team.score !== null && !nonnegativeInteger(team.score)) {
    issue(issues, "INVALID_MATCH_SCORE", "Recorded score must be a nonnegative integer.", `${path}.score`);
  }
  for (const [field, value] of [
    ["makes", team.makes],
    ["attempts", team.attempts],
    ["cupsScored", team.cupsScored],
    ["cupsAgainst", team.cupsAgainst]
  ] as const) {
    if (!nonnegativeInteger(value)) {
      issue(issues, "INVALID_MATCH_METRIC", "Match metrics must be nonnegative integers.", `${path}.${field}`);
    }
  }
  if (team.makes > team.attempts) {
    issue(issues, "INVALID_SHOOTING_COUNTS", "Makes cannot exceed attempts.", path);
  }
}

function validateResultsAndScores(
  match: PodStandingMatchInput,
  path: string,
  issues: PodStandingsValidationIssue[]
): void {
  const results = match.teams.map((team) => team.result);
  const scoringAvailable = match.scoreAvailability === "partial" ||
    match.scoreAvailability === "complete";
  if (scoringAvailable) {
    for (const [index, team] of match.teams.entries()) {
      const opponent = match.teams[index === 0 ? 1 : 0];
      if (team.score === null || team.score !== team.cupsScored ||
          team.cupsAgainst !== opponent.cupsScored) {
        issue(issues, "INCONSISTENT_MATCH_METRICS", "Available scores must match canonical cup totals.", `${path}.teams[${index}]`);
      }
    }
  } else if (match.teams.some((team) =>
    team.score !== null || team.makes !== 0 || team.attempts !== 0 ||
    team.cupsScored !== 0 || team.cupsAgainst !== 0
  )) {
    issue(issues, "UNAVAILABLE_MATCH_METRICS", "Unavailable standings inputs must contain no score or shooting metrics.", `${path}.teams`);
  }

  if (match.status === "final" && match.scoreAvailability === "complete") {
    const winner = match.teams.find((team) => team.result === "win");
    const loser = match.teams.find((team) => team.result === "loss");
    if (winner === undefined || loser === undefined ||
        results.filter((result) => result === "win").length !== 1 ||
        results.filter((result) => result === "loss").length !== 1 ||
        winner.score === null || loser.score === null || winner.score <= loser.score) {
      issue(issues, "INVALID_FINAL_RESULT", "A complete final requires one score-derived winner and loser.", path);
    }
    return;
  }
  if (match.status === "forfeited") {
    if (results.filter((result) => result === "win").length !== 1 ||
        results.filter((result) => result === "forfeited").length !== 1) {
      issue(issues, "INVALID_FORFEIT_RESULT", "A forfeit requires one winner and one forfeited team.", path);
    }
    return;
  }
  if (match.status === "cancelled") {
    if (results.some((result) => result !== "cancelled")) {
      issue(issues, "INVALID_CANCELLATION_RESULT", "A cancellation requires two cancelled team results.", path);
    }
    return;
  }
  if (results.some((result) => result !== "pending")) {
    issue(issues, "UNRESOLVED_MATCH_RESULT", "Unresolved matches require pending team results.", path);
  }
}

function validateResolutionIdentity(
  resolution: PodStandingTieResolution,
  path: string,
  issues: PodStandingsValidationIssue[]
): void {
  if (!isStableUuid(resolution.resolutionId)) {
    issue(issues, "INVALID_TIE_RESOLUTION_ID", "Tie resolution identity must be a stable UUID.", `${path}.resolutionId`);
  }
  if (!/^[a-f0-9]{64}$/.test(resolution.tieGroupId)) {
    issue(issues, "INVALID_TIE_GROUP_ID", "Tie group identity must be a canonical digest.", `${path}.tieGroupId`);
  }
  if (resolution.reason.length < 3 || resolution.reason.length > 500) {
    issue(issues, "INVALID_TIE_RESOLUTION_REASON", "Tie resolution reason must contain 3 to 500 characters.", `${path}.reason`);
  }
  if (!isStableUuid(resolution.resolvedBy)) {
    issue(issues, "INVALID_TIE_RESOLUTION_ACTOR", "Tie resolution requires a stable administrator identity.", `${path}.resolvedBy`);
  }
  if (!validTimestamp(resolution.resolvedAt)) {
    issue(issues, "INVALID_TIE_RESOLUTION_TIME", "Tie resolution time must be canonical ISO-8601.", `${path}.resolvedAt`);
  }
}

function normalizeResolution(
  resolution: PodStandingTieResolution
): PodStandingTieResolution {
  return { ...resolution, reason: resolution.reason.trim() };
}

function issue(
  issues: PodStandingsValidationIssue[],
  code: string,
  message: string,
  path?: string
): void {
  issues.push({ code, message, ...(path === undefined ? {} : { path }) });
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function nonnegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}
