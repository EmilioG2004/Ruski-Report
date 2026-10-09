/**
 * Calculates cups removed from normalized events. Score values come from the
 * game definition so special shots can affect the match without being counted
 * as ordinary makes in shooting statistics.
 */
import { GameEvent, TeamId } from "../../../domain";
import { ruskiGameDefinition } from "../definition";

const cupValueByEventType = new Map<string, number>(
  ruskiGameDefinition.eventTypes.flatMap((eventType): [string, number][] => {
    const cupCount = eventType.metadata?.cupCount;

    return eventType.affectsScore === true && typeof cupCount === "number"
      ? [[eventType.id, cupCount]]
      : [];
  })
);

export function calculateRuskiCupScore(
  events: readonly GameEvent[],
  teamId: TeamId
): number {
  return events.reduce((score, event) => {
    if (event.teamId !== teamId) {
      return score;
    }

    return score + (cupValueByEventType.get(event.type) ?? 0);
  }, 0);
}
