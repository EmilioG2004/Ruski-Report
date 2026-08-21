import {
  analyzeBracketCorrectionImpact,
  BracketCorrectionImpactPlan,
  generateMirroredBracketTopology,
  resolveBracketAdvancements,
  SINGLE_ELIMINATION_BRACKET_RULES_VERSION
} from "../../tournament-engine/bracket";
import {
  MatchId,
  PodId,
  TournamentTeamId
} from "../../tournament-engine/domain";
import {
  ReplacementPlayoffMatchInput,
  TournamentProgressionRecord
} from "../../tournament-engine/persistence";
import { createUuidV5 } from "../../tournament-engine/scheduling/uuid-v5";
import { EffectiveSeedPlan } from "../../tournament-engine/seeding";
import { WorkbookGenerationSourceRecord } from "../../tournament-engine/workbook";

export interface PreparedBracketCorrectionPlan {
  readonly impact: BracketCorrectionImpactPlan;
  readonly previousResolutionId: string;
  readonly replacements: readonly ReplacementPlayoffMatchInput[];
}

interface BracketCorrectionPlanBaseInput {
  progression: TournamentProgressionRecord;
  source: WorkbookGenerationSourceRecord;
  correctedMatchId: MatchId;
  reason: string;
}

type PrepareBracketCorrectionPlanInput = BracketCorrectionPlanBaseInput & (
  | {
      correctedWinnerTeamId: TournamentTeamId;
      correctedNoWinnerStatus?: never;
    }
  | {
      correctedWinnerTeamId: null;
      correctedNoWinnerStatus: "cancelled" | "postponed";
    }
);

export function prepareBracketCorrectionPlan(
  input: PrepareBracketCorrectionPlanInput
): PreparedBracketCorrectionPlan {
  const bracket = input.progression.activeBracket;
  if (bracket === undefined) throw new Error("Active bracket is unavailable.");
  const topology = generateMirroredBracketTopology({
    tournamentId: input.progression.tournamentId,
    rulesVersion: SINGLE_ELIMINATION_BRACKET_RULES_VERSION,
    bracketSize: input.progression.bracketSize,
    allowByes: input.source.configuration.allowByes,
    effectiveSeedPlan: effectiveSeedPlan(input.progression)
  });
  if (topology.bracketId !== bracket.bracketId) {
    throw new Error("Active bracket topology is stale.");
  }
  const records = bracket.rounds.flatMap((round) => round.matches);
  const corrected = records.find((match) => match.matchId === input.correctedMatchId);
  if (corrected?.winnerTeamId === undefined || corrected.resolutionId === undefined ||
      corrected.bracketMatchId === undefined) {
    throw new Error("Corrected bracket source is not resolved.");
  }
  const activeMatches = records.flatMap((match) => {
    if (match.matchId === undefined || match.instanceNumber === undefined ||
        match.participantTeamIds === undefined ||
        match.participantsFrozen === undefined || match.matchStatus === undefined ||
        match.scoreAvailability === undefined) {
      return [];
    }
    return [{
      bracketMatchId: match.bracketMatchId,
      matchId: match.matchId,
      instanceNumber: match.instanceNumber,
      participantTeamIds: match.participantTeamIds,
      participantsFrozen: match.participantsFrozen,
      status: match.matchStatus,
      scoreAvailability: match.scoreAvailability,
      winnerTeamId: match.winnerTeamId ?? null
    }];
  });
  const current = resolveBracketAdvancements({ topology, activeMatches });
  const impact = analyzeBracketCorrectionImpact({
    current,
    correctedBracketMatchId: corrected.bracketMatchId,
    previousWinnerTeamId: corrected.winnerTeamId,
    ...(input.correctedWinnerTeamId === null
      ? {
          correctedWinnerTeamId: null,
          correctedNoWinnerStatus: input.correctedNoWinnerStatus
        }
      : { correctedWinnerTeamId: input.correctedWinnerTeamId })
  });
  let nextSequence = input.source.matches.reduce(
    (maximum, match) => Math.max(maximum, match.sequence),
    0
  );
  const replacements = impact.actions.flatMap<ReplacementPlayoffMatchInput>((action) => {
    const replacement = action.replacement;
    if (replacement === null || action.preservedMatchId === null) return [];
    const node = records.find((match) => match.bracketMatchId === action.bracketMatchId);
    if (node === undefined) throw new Error("Cascade bracket node is unavailable.");
    nextSequence += 1;
    const common = {
      replacementId: createUuidV5(replacement.matchId, "replacement-record"),
      bracketMatchId: action.bracketMatchId,
      previousMatchId: action.preservedMatchId,
      reason: input.reason
    };
    const match = {
      id: replacement.matchId,
      publicKey: `playoff-match-${replacement.matchId}`,
      sequence: nextSequence,
      metadata: {
        bracketMatchId: action.bracketMatchId,
        instanceNumber: replacement.instanceNumber,
        replacementOf: action.preservedMatchId
      }
    };
    if (replacement.participantTeamIds === null) {
      return [{
        ...common,
        createWhenPlayable: true,
        pendingMatch: match
      }];
    }
    return [{
      ...common,
      match: {
        ...match,
        slots: node.slots.map((slot) => ({
          id: createUuidV5(replacement.matchId, `slot|${slot.slotNumber}`),
          publicKey: `playoff-match-slot-${replacement.matchId}-${slot.slotNumber}`,
          slotNumber: slot.slotNumber,
          sourceType: slot.sourceType,
          teamId: replacement.participantTeamIds?.[slot.slotNumber - 1],
          ...(slot.sourceBracketMatchId === undefined
            ? {}
            : { sourceBracketMatchId: slot.sourceBracketMatchId }),
          ...(slot.seed === undefined ? {} : { seed: slot.seed }),
          metadata: { replacement: true }
        }))
      }
    }];
  });
  return { impact, previousResolutionId: corrected.resolutionId, replacements };
}

function effectiveSeedPlan(
  progression: TournamentProgressionRecord
): EffectiveSeedPlan {
  const review = progression.activeGlobalSeedReview;
  const calculationId = progression.activeSeedCalculationId;
  if (review === undefined || calculationId === undefined ||
      review.seedCalculationId !== calculationId) {
    throw new Error("Active effective seeds are unavailable.");
  }
  const podByTeam = new Map<TournamentTeamId, PodId>();
  progression.pods.forEach((pod) => pod.rows
    .filter((row) => row.qualified)
    .forEach((row) => podByTeam.set(row.teamId, pod.podId)));
  const rows = progression.effectiveSeeds.map((seed) => {
    const podId = podByTeam.get(seed.teamId);
    if (podId === undefined) throw new Error("Effective seed pod is unavailable.");
    return { ...seed, podId };
  });
  const override = progression.activeSeedOverride;
  return {
    tournamentId: progression.tournamentId,
    seedCalculationId: calculationId,
    seedCalculationInputDigest: review.inputDigest,
    source: override === undefined ? "calculated" : "administrator_override",
    overrideDigest: override?.overrideDigest ?? null,
    audit: override === undefined ? null : {
      overrideId: override.commandId,
      reason: override.reason,
      overriddenBy: override.administratorId,
      overriddenAt: override.occurredAt
    },
    rows,
    changes: rows.filter((row) => row.calculatedSeed !== row.effectiveSeed)
      .map((row) => ({
        teamId: row.teamId,
        previousSeed: row.calculatedSeed,
        newSeed: row.effectiveSeed
      }))
  };
}
