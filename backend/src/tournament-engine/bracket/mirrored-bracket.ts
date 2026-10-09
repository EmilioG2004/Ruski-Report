import {
  BracketMatchId,
  isStableUuid,
  MatchId,
  TournamentTeamId
} from "../domain";
import { canonicalSha256 } from "../workbook/canonical-json";
import {
  ActiveBracketMatchInput,
  BracketMatchBlockingReason,
  BracketMatchInstanceProjection,
  BracketResolvedMatch,
  BracketResolvedRound,
  BracketResolvedSlot,
  BracketResolvedSlotState,
  BracketResolutionPlan,
  BracketTopologyMatch,
  BracketTopologyRound,
  BracketValidationIssue,
  GenerateMirroredBracketTopologyInput,
  MirroredBracketTopology,
  ResolveBracketAdvancementsInput,
  SINGLE_ELIMINATION_BRACKET_RULES_VERSION
} from "./contracts";
import { BracketValidationError } from "./errors";
import {
  createBracketMatchId,
  createBracketRoundId,
  createBracketSlotId,
  createSingleEliminationBracketId,
  createStablePlayoffMatchInstanceId
} from "./bracket-identity";

export function createMirroredSeedPlacementOrder(
  bracketSize: number
): readonly number[] {
  if (!isPowerOfTwo(bracketSize) || bracketSize < 2) {
    invalid("bracket_size", "Bracket size must be a power of two greater than one.");
  }
  if (bracketSize === 2) {
    return [1, 2];
  }
  const inner = createMirroredSeedPlacementOrder(bracketSize / 2);
  return inner.flatMap((seed) => [seed, bracketSize + 1 - seed]);
}

export function generateMirroredBracketTopology(
  input: GenerateMirroredBracketTopologyInput
): MirroredBracketTopology {
  validateTopologyInput(input);
  const bracketId = createSingleEliminationBracketId(input.tournamentId);
  const placementOrder = createMirroredSeedPlacementOrder(input.bracketSize);
  const roundCount = Math.log2(input.bracketSize);
  const rounds: BracketTopologyRound[] = [];
  let globalSequence = 1;

  for (let roundNumber = 1; roundNumber <= roundCount; roundNumber += 1) {
    const roundId = createBracketRoundId(bracketId, roundNumber);
    const matchCount = input.bracketSize / (2 ** roundNumber);
    const matches: BracketTopologyMatch[] = [];
    for (let position = 1; position <= matchCount; position += 1) {
      const matchId = createBracketMatchId(bracketId, roundNumber, position);
      const sources = roundNumber === 1
        ? [
          { type: "seed" as const, seed: placementOrder[(position - 1) * 2] },
          { type: "seed" as const, seed: placementOrder[(position - 1) * 2 + 1] }
        ] as const
        : [
          {
            type: "winner" as const,
            bracketMatchId: createBracketMatchId(
              bracketId,
              roundNumber - 1,
              (position - 1) * 2 + 1
            )
          },
          {
            type: "winner" as const,
            bracketMatchId: createBracketMatchId(
              bracketId,
              roundNumber - 1,
              (position - 1) * 2 + 2
            )
          }
        ] as const;
      matches.push({
        id: matchId,
        roundId,
        roundNumber,
        position,
        sequence: globalSequence,
        slots: [
          {
            id: createBracketSlotId(matchId, 1),
            slotNumber: 1,
            source: sources[0]
          },
          {
            id: createBracketSlotId(matchId, 2),
            slotNumber: 2,
            source: sources[1]
          }
        ]
      });
      globalSequence += 1;
    }
    rounds.push({
      id: roundId,
      roundNumber,
      name: roundName(input.bracketSize, roundNumber),
      matchCount,
      matches
    });
  }

  const effectiveSeeds = [...input.effectiveSeedPlan.rows]
    .sort((left, right) => left.effectiveSeed - right.effectiveSeed);
  const topologyWithoutDigest = {
    tournamentId: input.tournamentId,
    bracketId,
    rulesVersion: input.rulesVersion,
    placementPolicy: "standard_mirrored_seeded" as const,
    bracketSize: input.bracketSize,
    qualifierCount: effectiveSeeds.length,
    seedCalculationId: input.effectiveSeedPlan.seedCalculationId,
    seedCalculationInputDigest:
      input.effectiveSeedPlan.seedCalculationInputDigest,
    effectiveSeedSource: input.effectiveSeedPlan.source,
    effectiveSeedOverrideDigest: input.effectiveSeedPlan.overrideDigest,
    placementOrder,
    effectiveSeeds,
    rounds
  };
  return {
    ...topologyWithoutDigest,
    topologyDigest: canonicalSha256(topologyWithoutDigest)
  };
}

export function resolveBracketAdvancements(
  input: ResolveBracketAdvancementsInput
): BracketResolutionPlan {
  validateTopology(input.topology);
  const topologyMatches = input.topology.rounds.flatMap((round) => round.matches);
  const topologyMatchIds = new Set(topologyMatches.map((match) => match.id));
  const activeByBracketMatch = new Map<BracketMatchId, ActiveBracketMatchInput>();
  const activeMatchIds = new Set<MatchId>();
  for (const active of input.activeMatches) {
    if (!topologyMatchIds.has(active.bracketMatchId)) {
      invalid("active_match_unknown_node", "An active playoff match references a node outside this bracket.");
    }
    if (activeByBracketMatch.has(active.bracketMatchId)) {
      invalid("active_match_duplicate_node", "A bracket node may have only one active match instance.");
    }
    if (activeMatchIds.has(active.matchId)) {
      invalid("active_match_duplicate_id", "An active playoff match ID may appear only once.");
    }
    activeByBracketMatch.set(active.bracketMatchId, active);
    activeMatchIds.add(active.matchId);
  }

  const effectiveBySeed = new Map(
    input.topology.effectiveSeeds.map((seed) => [seed.effectiveSeed, seed])
  );
  const resolvedById = new Map<BracketMatchId, BracketResolvedMatch>();
  const rounds: BracketResolvedRound[] = [];
  const ordinaryMatches: BracketMatchInstanceProjection[] = [];
  const blockedBracketMatchIds: BracketMatchId[] = [];

  for (const round of input.topology.rounds) {
    const resolvedMatches = round.matches.map((match) => {
      const slots = match.slots.map((slot) => ({
        ...slot,
        state: resolveSlotState(
          slot.source,
          effectiveBySeed,
          resolvedById,
          input.topology.qualifierCount
        )
      })) as [BracketResolvedSlot, BracketResolvedSlot];
      const active = activeByBracketMatch.get(match.id);
      const resolved = resolveMatch(
        input.topology,
        match,
        slots,
        active
      );
      if (resolved.matchInstance !== null) {
        ordinaryMatches.push(resolved.matchInstance);
      }
      if (resolved.state === "blocked") {
        blockedBracketMatchIds.push(resolved.id);
      }
      resolvedById.set(match.id, resolved);
      return resolved;
    });
    rounds.push({ ...round, matches: resolvedMatches });
  }

  for (const activeId of activeByBracketMatch.keys()) {
    const resolved = resolvedById.get(activeId);
    if (resolved?.matchInstance === null) {
      invalid(
        "active_match_structural_node",
        "Bye, empty, and unresolved bracket nodes cannot own an ordinary scored match."
      );
    }
  }
  const finalMatch = rounds.at(-1)?.matches[0];
  const resolutionWithoutDigest = {
    topology: input.topology,
    rounds,
    championTeamId: finalMatch?.winnerTeamId ?? null,
    playableMatches: ordinaryMatches,
    blockedBracketMatchIds
  };
  return {
    ...resolutionWithoutDigest,
    resolutionDigest: canonicalSha256(resolutionWithoutDigest)
  };
}

function resolveSlotState(
  source: BracketTopologyMatch["slots"][number]["source"],
  effectiveBySeed: ReadonlyMap<number, MirroredBracketTopology["effectiveSeeds"][number]>,
  resolvedById: ReadonlyMap<BracketMatchId, BracketResolvedMatch>,
  qualifierCount: number
): BracketResolvedSlotState {
  if (source.type === "seed") {
    const seed = effectiveBySeed.get(source.seed);
    return seed === undefined
      ? { type: "bye", seed: source.seed }
      : {
        type: "team",
        teamId: seed.teamId,
        effectiveSeed: seed.effectiveSeed
      };
  }
  const sourceMatch = resolvedById.get(source.bracketMatchId);
  if (sourceMatch === undefined) {
    throw new Error("Bracket topology source order is invalid.");
  }
  if (sourceMatch.winnerTeamId !== null) {
    return {
      type: "team",
      teamId: sourceMatch.winnerTeamId,
      effectiveSeed: requireTeamSeed(sourceMatch.winnerTeamId, resolvedById, qualifierCount)
    };
  }
  return sourceMatch.state === "empty"
    ? { type: "empty" }
    : { type: "tbd" };
}

function requireTeamSeed(
  teamId: TournamentTeamId,
  resolvedById: ReadonlyMap<BracketMatchId, BracketResolvedMatch>,
  _qualifierCount: number
): number {
  for (const match of resolvedById.values()) {
    for (const slot of match.slots) {
      if (slot.state.type === "team" && slot.state.teamId === teamId) {
        return slot.state.effectiveSeed;
      }
    }
  }
  throw new Error("Resolved winner is missing its effective seed.");
}

function resolveMatch(
  topology: MirroredBracketTopology,
  match: BracketTopologyMatch,
  slots: readonly [BracketResolvedSlot, BracketResolvedSlot],
  active: ActiveBracketMatchInput | undefined
): BracketResolvedMatch {
  const teams = slots
    .filter((slot): slot is BracketResolvedSlot & {
      readonly state: Extract<BracketResolvedSlotState, { readonly type: "team" }>;
    } => slot.state.type === "team")
    .map((slot) => slot.state.teamId);
  const containsTbd = slots.some((slot) => slot.state.type === "tbd");
  if (teams.length === 2) {
    const participantTeamIds = teams as [TournamentTeamId, TournamentTeamId];
    const instance = active === undefined
      ? plannedInstance(topology, match.id, participantTeamIds)
      : validateAndProjectActive(topology, match.id, participantTeamIds, active);
    const outcome = active === undefined
      ? { state: "ready" as const, winnerTeamId: null }
      : activeOutcome(active);
    return {
      ...match,
      slots,
      ...outcome,
      matchInstance: instance
    };
  }
  if (active !== undefined) {
    invalid(
      "active_match_unresolved_participants",
      "An ordinary playoff match requires two resolved participant teams."
    );
  }
  if (teams.length === 1 && !containsTbd) {
    return {
      ...match,
      slots,
      state: "automatic_advance",
      winnerTeamId: teams[0],
      matchInstance: null
    };
  }
  if (teams.length === 0 && !containsTbd) {
    return {
      ...match,
      slots,
      state: "empty",
      winnerTeamId: null,
      matchInstance: null
    };
  }
  return {
    ...match,
    slots,
    state: "waiting",
    winnerTeamId: null,
    matchInstance: null
  };
}

function plannedInstance(
  topology: MirroredBracketTopology,
  bracketMatchId: BracketMatchId,
  participantTeamIds: readonly [TournamentTeamId, TournamentTeamId]
): BracketMatchInstanceProjection {
  return {
    matchId: createStablePlayoffMatchInstanceId({
      tournamentId: topology.tournamentId,
      bracketMatchId,
      instanceNumber: 1
    }),
    instanceNumber: 1,
    participantTeamIds,
    participantsFrozen: false,
    status: "scheduled",
    scoreAvailability: "not_started"
  };
}

function validateAndProjectActive(
  topology: MirroredBracketTopology,
  bracketMatchId: BracketMatchId,
  participantTeamIds: readonly [TournamentTeamId, TournamentTeamId],
  active: ActiveBracketMatchInput
): BracketMatchInstanceProjection {
  if (!Number.isSafeInteger(active.instanceNumber) || active.instanceNumber < 1) {
    invalid("active_match_instance", "A playoff match instance number must be positive.");
  }
  const expectedMatchId = createStablePlayoffMatchInstanceId({
    tournamentId: topology.tournamentId,
    bracketMatchId,
    instanceNumber: active.instanceNumber
  });
  if (active.matchId !== expectedMatchId) {
    invalid("active_match_id", "A playoff match instance ID does not match its stable bracket identity.");
  }
  if (active.participantTeamIds[0] !== participantTeamIds[0] ||
      active.participantTeamIds[1] !== participantTeamIds[1]) {
    invalid("active_match_participants", "Active playoff match participants do not match resolved bracket slots.");
  }
  validateActiveOutcome(active);
  return {
    matchId: active.matchId,
    instanceNumber: active.instanceNumber,
    participantTeamIds: active.participantTeamIds,
    participantsFrozen: active.participantsFrozen,
    status: active.status,
    scoreAvailability: active.scoreAvailability
  };
}

function activeOutcome(active: ActiveBracketMatchInput): Pick<
  BracketResolvedMatch,
  "state" | "winnerTeamId" | "blockingReason"
> {
  switch (active.status) {
    case "scheduled":
      return { state: "ready", winnerTeamId: null };
    case "in_progress":
      return { state: "in_progress", winnerTeamId: null };
    case "postponed":
      return { state: "blocked", blockingReason: "postponed", winnerTeamId: null };
    case "cancelled":
      return { state: "blocked", blockingReason: "cancelled", winnerTeamId: null };
    case "final":
      return active.scoreAvailability === "unrecorded"
        ? { state: "blocked", blockingReason: "final_unrecorded", winnerTeamId: null }
        : { state: "completed", winnerTeamId: active.winnerTeamId };
    case "forfeited":
      return { state: "completed", winnerTeamId: active.winnerTeamId };
  }
}

function validateActiveOutcome(active: ActiveBracketMatchInput): void {
  const winnerIsParticipant = active.winnerTeamId !== null &&
    active.participantTeamIds.includes(active.winnerTeamId);
  const valid =
    (active.status === "scheduled" && active.scoreAvailability === "not_started" &&
      active.winnerTeamId === null) ||
    (active.status === "in_progress" && active.scoreAvailability === "partial" &&
      active.winnerTeamId === null) ||
    (active.status === "postponed" &&
      (active.scoreAvailability === "not_started" || active.scoreAvailability === "partial") &&
      active.winnerTeamId === null) ||
    (active.status === "cancelled" && active.scoreAvailability === "not_applicable" &&
      active.winnerTeamId === null) ||
    (active.status === "final" && active.scoreAvailability === "unrecorded" &&
      active.winnerTeamId === null) ||
    (active.status === "final" && active.scoreAvailability === "complete" &&
      winnerIsParticipant) ||
    (active.status === "forfeited" && active.scoreAvailability === "not_applicable" &&
      winnerIsParticipant);
  if (!valid) {
    invalid("active_match_state", "Playoff match status, score availability, and winner are inconsistent.");
  }
}

function validateTopologyInput(input: GenerateMirroredBracketTopologyInput): void {
  if (!isStableUuid(input.tournamentId)) {
    invalid("tournament_id", "Tournament ID must be a non-nil UUID.");
  }
  if (input.rulesVersion !== SINGLE_ELIMINATION_BRACKET_RULES_VERSION) {
    invalid("rules_version", `Bracket generation requires rules version ${SINGLE_ELIMINATION_BRACKET_RULES_VERSION}.`);
  }
  if (!isPowerOfTwo(input.bracketSize) || input.bracketSize < 2) {
    invalid("bracket_size", "Bracket size must be a power of two greater than one.");
  }
  if (input.effectiveSeedPlan.tournamentId !== input.tournamentId) {
    invalid("seed_tournament", "Effective seeds must belong to the bracket tournament.");
  }
  if (!isStableUuid(input.effectiveSeedPlan.seedCalculationId) ||
      !/^[a-f0-9]{64}$/.test(input.effectiveSeedPlan.seedCalculationInputDigest)) {
    invalid("seed_calculation_identity", "Effective seeds require a stable calculation ID and input digest.");
  }
  if ((input.effectiveSeedPlan.source === "calculated" &&
      (input.effectiveSeedPlan.overrideDigest !== null ||
        input.effectiveSeedPlan.audit !== null ||
        input.effectiveSeedPlan.changes.length !== 0)) ||
      (input.effectiveSeedPlan.source === "administrator_override" &&
      (!/^[a-f0-9]{64}$/.test(input.effectiveSeedPlan.overrideDigest ?? "") ||
        input.effectiveSeedPlan.audit === null ||
        input.effectiveSeedPlan.changes.length === 0))) {
    invalid("effective_seed_source", "Effective seed source and override audit fields are inconsistent.");
  }
  const rows = input.effectiveSeedPlan.rows;
  if (rows.length < 1 || rows.length > input.bracketSize) {
    invalid("qualifier_count", "Qualifier count must be between one and bracket size.");
  }
  if (rows.length < input.bracketSize && !input.allowByes) {
    invalid("byes_disabled", "An undersized qualifier field requires byes to be enabled.");
  }
  const teams = new Set<string>();
  const seeds = new Set<number>();
  const calculatedSeeds = new Set<number>();
  for (const row of rows) {
    if (!isStableUuid(row.teamId) || !isStableUuid(row.podId)) {
      invalid("effective_seed_identity", "Effective seed rows require stable team and pod IDs.");
    }
    if (!Number.isSafeInteger(row.calculatedSeed) || row.calculatedSeed < 1 ||
        !Number.isSafeInteger(row.effectiveSeed) || row.effectiveSeed < 1 ||
        teams.has(row.teamId) || seeds.has(row.effectiveSeed) ||
        calculatedSeeds.has(row.calculatedSeed)) {
      invalid("effective_seed_unique", "Calculated and effective seed positions must be positive and unique.");
    }
    teams.add(row.teamId);
    seeds.add(row.effectiveSeed);
    calculatedSeeds.add(row.calculatedSeed);
  }
  for (let seed = 1; seed <= rows.length; seed += 1) {
    if (!seeds.has(seed) || !calculatedSeeds.has(seed)) {
      invalid("effective_seed_sequence", "Calculated and effective seeds must be contiguous from one.");
    }
  }
}

function validateTopology(topology: MirroredBracketTopology): void {
  const digest = canonicalSha256({
    tournamentId: topology.tournamentId,
    bracketId: topology.bracketId,
    rulesVersion: topology.rulesVersion,
    placementPolicy: topology.placementPolicy,
    bracketSize: topology.bracketSize,
    qualifierCount: topology.qualifierCount,
    seedCalculationId: topology.seedCalculationId,
    seedCalculationInputDigest: topology.seedCalculationInputDigest,
    effectiveSeedSource: topology.effectiveSeedSource,
    effectiveSeedOverrideDigest: topology.effectiveSeedOverrideDigest,
    placementOrder: topology.placementOrder,
    effectiveSeeds: topology.effectiveSeeds,
    rounds: topology.rounds
  });
  if (digest !== topology.topologyDigest) {
    invalid("topology_digest", "Bracket topology digest does not match its contents.");
  }
}

function roundName(bracketSize: number, roundNumber: number): string {
  const teamsRemaining = bracketSize / (2 ** (roundNumber - 1));
  switch (teamsRemaining) {
    case 2:
      return "Championship";
    case 4:
      return "Semifinals";
    case 8:
      return "Quarterfinals";
    default:
      return `Round of ${teamsRemaining}`;
  }
}

function isPowerOfTwo(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 &&
    Number.isInteger(Math.log2(value));
}

function invalid(code: string, message: string, path?: string): never {
  const issue: BracketValidationIssue = {
    code,
    message,
    ...(path === undefined ? {} : { path })
  };
  throw new BracketValidationError([issue]);
}
