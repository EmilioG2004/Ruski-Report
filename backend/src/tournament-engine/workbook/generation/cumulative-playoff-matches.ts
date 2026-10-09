import type { BracketResolutionPlan } from "../../bracket/contracts";
import { CanonicalWorkbookPlayoffMatchInput } from "./types";

export interface SelectCumulativePlayoffWorkbookMatchesInput {
  readonly resolution: BracketResolutionPlan;
  readonly firstSequence: number;
}

export function selectCumulativePlayoffWorkbookMatches(
  input: SelectCumulativePlayoffWorkbookMatchesInput
): readonly CanonicalWorkbookPlayoffMatchInput[] {
  if (!Number.isSafeInteger(input.firstSequence) || input.firstSequence < 1) {
    throw new Error("First cumulative playoff match sequence must be positive.");
  }
  return input.resolution.rounds
    .flatMap((round) => round.matches)
    .filter((match) => match.matchInstance !== null)
    .map((match, index) => {
      if (match.matchInstance === null) {
        throw new Error("Resolved playoff match lost its ordinary match instance.");
      }
      return {
        id: match.matchInstance.matchId,
        bracketMatchId: match.id,
        stage: "playoffs",
        sequence: input.firstSequence + index,
        roundNumber: match.roundNumber,
        sequenceInRound: match.position,
        participantTeamIds: match.matchInstance.participantTeamIds
      };
    });
}
