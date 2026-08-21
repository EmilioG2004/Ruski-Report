import {
  BracketMatchId,
  MatchId,
  TournamentTeamId
} from "../domain";
import { canonicalSha256 } from "../workbook/canonical-json";
import {
  AnalyzeBracketCorrectionImpactInput,
  BracketCorrectionCascadeAction,
  BracketCorrectionCascadeActionType,
  BracketCorrectionImpactPlan,
  BracketResolvedMatch,
  BracketResolvedSlotState,
  BracketValidationIssue,
  ConfirmBracketCorrectionImpactInput,
  ConfirmedBracketCorrectionImpact
} from "./contracts";
import { BracketValidationError } from "./errors";
import { createStablePlayoffMatchInstanceId } from "./bracket-identity";

export function analyzeBracketCorrectionImpact(
  input: AnalyzeBracketCorrectionImpactInput
): BracketCorrectionImpactPlan {
  const matches = input.current.rounds.flatMap((round) => round.matches);
  const corrected = matches.find((match) => match.id === input.correctedBracketMatchId);
  if (corrected === undefined) {
    invalid("corrected_match", "The corrected match is outside the current bracket.");
  }
  if (corrected.winnerTeamId !== input.previousWinnerTeamId) {
    invalid("previous_winner", "The previous winner does not match current bracket state.");
  }
  const correctedNoWinnerStatus = correctedNoWinnerStatusOf(input);
  if (input.correctedWinnerTeamId !== null) {
    const correctedParticipants = participantTeamIds(corrected);
    if (correctedParticipants === null ||
        !correctedParticipants.includes(input.correctedWinnerTeamId)) {
      invalid("corrected_winner", "The corrected winner must be a participant in the corrected match.");
    }
  }
  const winnerChanged = input.previousWinnerTeamId !== input.correctedWinnerTeamId;
  const actions = winnerChanged
    ? cascadeActions(input, matches)
    : [];
  const requiresConfirmation = actions.some((action) =>
    action.action === "replace_started_match" ||
    action.action === "supersede_started_match_until_resolved"
  );
  const impactWithoutDigest = {
    tournamentId: input.current.topology.tournamentId,
    bracketId: input.current.topology.bracketId,
    correctedBracketMatchId: input.correctedBracketMatchId,
    previousWinnerTeamId: input.previousWinnerTeamId,
    correctedWinnerTeamId: input.correctedWinnerTeamId,
    correctedNoWinnerStatus,
    winnerChanged,
    requiresConfirmation,
    actions
  };
  return {
    ...impactWithoutDigest,
    confirmationDigest: canonicalSha256(impactWithoutDigest)
  };
}

export function confirmBracketCorrectionImpact(
  input: ConfirmBracketCorrectionImpactInput
): ConfirmedBracketCorrectionImpact {
  if (input.confirmationDigest !== input.impact.confirmationDigest) {
    invalid("correction_confirmation_digest", "Correction confirmation is stale or does not match the preview.");
  }
  return { ...input.impact, confirmed: true };
}

function cascadeActions(
  input: AnalyzeBracketCorrectionImpactInput,
  matches: readonly BracketResolvedMatch[]
): readonly BracketCorrectionCascadeAction[] {
  const byId = new Map(matches.map((match) => [match.id, match]));
  const actions: BracketCorrectionCascadeAction[] = [];
  let changedSourceId = input.correctedBracketMatchId;
  let nextSourceState: BracketResolvedSlotState =
    input.correctedWinnerTeamId === null
      ? { type: "tbd" }
      : {
        type: "team",
        teamId: input.correctedWinnerTeamId,
        effectiveSeed: effectiveSeed(input.current, input.correctedWinnerTeamId)
      };

  while (true) {
    const parent = matches.find((candidate) => candidate.slots.some((slot) =>
      slot.source.type === "winner" &&
      slot.source.bracketMatchId === changedSourceId
    ));
    if (parent === undefined) {
      break;
    }
    const changedSlotIndex = parent.slots.findIndex((slot) =>
      slot.source.type === "winner" &&
      slot.source.bracketMatchId === changedSourceId
    );
    if (changedSlotIndex !== 0 && changedSlotIndex !== 1) {
      throw new Error("Single-elimination parent lost its source slot.");
    }
    const nextSlots = [...parent.slots] as [
      BracketResolvedMatch["slots"][number],
      BracketResolvedMatch["slots"][number]
    ];
    nextSlots[changedSlotIndex] = {
      ...nextSlots[changedSlotIndex],
      state: nextSourceState
    };
    const nextParticipants = resolvedParticipants(nextSlots.map((slot) => slot.state));
    const priorParticipants = participantTeamIds(parent);
    const structuralWinner = automaticWinner(nextSlots.map((slot) => slot.state));
    const action = correctionAction(
      input,
      parent,
      (changedSlotIndex + 1) as 1 | 2,
      priorParticipants,
      nextParticipants,
      structuralWinner
    );
    actions.push(action);

    const priorWinner = parent.winnerTeamId;
    const nextWinner = structuralWinner;
    if (priorWinner === nextWinner) {
      break;
    }
    changedSourceId = parent.id;
    nextSourceState = nextWinner === null
      ? { type: "tbd" }
      : {
        type: "team",
        teamId: nextWinner,
        effectiveSeed: effectiveSeed(input.current, nextWinner)
      };
    if (!byId.has(changedSourceId)) {
      throw new Error("Correction cascade left the current bracket.");
    }
  }
  return actions;
}

function correctionAction(
  input: AnalyzeBracketCorrectionImpactInput,
  match: BracketResolvedMatch,
  changedSlotNumber: 1 | 2,
  priorParticipants: readonly [TournamentTeamId, TournamentTeamId] | null,
  nextParticipants: readonly [TournamentTeamId, TournamentTeamId] | null,
  nextWinnerTeamId: TournamentTeamId | null
): BracketCorrectionCascadeAction {
  const currentInstance = match.matchInstance;
  let action: BracketCorrectionCascadeActionType;
  let preservedMatchId: MatchId | null = currentInstance?.matchId ?? null;
  let replacement: BracketCorrectionCascadeAction["replacement"] = null;
  if (currentInstance === null) {
    action = "update_structural_node";
  } else if (!currentInstance.participantsFrozen) {
    action = nextParticipants === null
      ? "clear_unfrozen_match_until_resolved"
      : "update_unfrozen_match";
  } else {
    action = nextParticipants === null
      ? "supersede_started_match_until_resolved"
      : "replace_started_match";
    const instanceNumber = currentInstance.instanceNumber + 1;
    replacement = {
      matchId: createStablePlayoffMatchInstanceId({
        tournamentId: input.current.topology.tournamentId,
        bracketMatchId: match.id,
        instanceNumber
      }),
      instanceNumber,
      participantTeamIds: nextParticipants,
      createWhenPlayable: nextParticipants === null
    };
  }
  return {
    bracketMatchId: match.id,
    changedSlotNumber,
    action,
    priorWinnerTeamId: match.winnerTeamId,
    nextWinnerTeamId,
    priorParticipantTeamIds: priorParticipants,
    nextParticipantTeamIds: nextParticipants,
    preservedMatchId,
    replacement
  };
}

function participantTeamIds(
  match: BracketResolvedMatch
): readonly [TournamentTeamId, TournamentTeamId] | null {
  return resolvedParticipants(match.slots.map((slot) => slot.state));
}

function resolvedParticipants(
  states: readonly BracketResolvedSlotState[]
): readonly [TournamentTeamId, TournamentTeamId] | null {
  if (states[0]?.type !== "team" || states[1]?.type !== "team") {
    return null;
  }
  return [states[0].teamId, states[1].teamId];
}

function automaticWinner(
  states: readonly BracketResolvedSlotState[]
): TournamentTeamId | null {
  const teams = states.filter((state): state is Extract<
    BracketResolvedSlotState,
    { readonly type: "team" }
  > => state.type === "team");
  const containsTbd = states.some((state) => state.type === "tbd");
  return teams.length === 1 && !containsTbd ? teams[0].teamId : null;
}

function effectiveSeed(
  current: AnalyzeBracketCorrectionImpactInput["current"],
  teamId: TournamentTeamId
): number {
  const seed = current.topology.effectiveSeeds.find((row) => row.teamId === teamId);
  if (seed === undefined) {
    invalid("correction_team_seed", "A correction participant is outside the effective seed field.");
  }
  return seed.effectiveSeed;
}

function correctedNoWinnerStatusOf(
  input: AnalyzeBracketCorrectionImpactInput
): "cancelled" | "postponed" | null {
  if (input.correctedWinnerTeamId !== null) {
    return null;
  }
  if (input.correctedNoWinnerStatus !== "cancelled" &&
      input.correctedNoWinnerStatus !== "postponed") {
    invalid(
      "corrected_no_winner_status",
      "A no-winner correction must be cancelled or postponed."
    );
  }
  return input.correctedNoWinnerStatus;
}

function invalid(code: string, message: string): never {
  const issue: BracketValidationIssue = { code, message };
  throw new BracketValidationError([issue]);
}
