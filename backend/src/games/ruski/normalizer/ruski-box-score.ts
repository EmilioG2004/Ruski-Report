import {
  BoxScore,
  BoxScoreRow,
  BoxScoreStatValue,
  GameEvent,
  PlayerId,
  TeamId
} from "../../../domain";
import {
  RUSKI_EVENT_TYPE_IDS,
  RUSKI_GAME_TYPE,
  RUSKI_STAT_KEYS,
  ruskiGameDefinition
} from "../definition";

const ruskiEventTypeById = new Map(
  ruskiGameDefinition.eventTypes.map((eventType) => [eventType.id, eventType])
);

export interface RuskiBoxScoreSubject {
  label: string;
  playerId?: PlayerId;
  teamId?: TeamId;
}

export function calculateRuskiBoxScore(
  matchId: string,
  events: readonly GameEvent[],
  subjects = new Map<string, RuskiBoxScoreSubject>()
): BoxScore {
  const rowsBySubject = new Map<string, BoxScoreRow>();
  const totals = createEmptyRuskiStats();

  events.forEach((event) => {
    const subjectKey = event.playerId ?? event.teamId ?? "match";
    const row =
      rowsBySubject.get(subjectKey) ??
      createBoxScoreRow(subjectKey, event, subjects.get(subjectKey));

    applyRuskiEventToStats(row.stats, event);
    applyRuskiEventToStats(totals, event);
    rowsBySubject.set(subjectKey, row);
  });

  return {
    matchId,
    gameType: RUSKI_GAME_TYPE,
    rows: [...rowsBySubject.values()].map((row) => ({
      ...row,
      stats: finalizeRuskiStats(row.stats)
    })),
    totals: finalizeRuskiStats(totals)
  };
}

export function createEmptyRuskiStats(): Record<string, BoxScoreStatValue> {
  return {
    [RUSKI_STAT_KEYS.makes]: 0,
    [RUSKI_STAT_KEYS.misses]: 0,
    [RUSKI_STAT_KEYS.shootingPercentage]: null,
    [RUSKI_STAT_KEYS.splashOuts]: 0,
    [RUSKI_STAT_KEYS.guys]: 0,
    [RUSKI_STAT_KEYS.tris]: 0,
    [RUSKI_STAT_KEYS.dis]: 0,
    [RUSKI_STAT_KEYS.voms]: 0
  };
}

function createBoxScoreRow(
  subjectKey: string,
  event: GameEvent,
  subject?: RuskiBoxScoreSubject
): BoxScoreRow {
  return {
    subject: {
      type:
        event.playerId !== undefined
          ? "player"
          : event.teamId !== undefined
            ? "team"
            : "match",
      label: subject?.label ?? subjectKey,
      playerId: subject?.playerId ?? event.playerId,
      teamId: subject?.teamId ?? event.teamId
    },
    stats: createEmptyRuskiStats()
  };
}

function applyRuskiEventToStats(
  stats: Record<string, BoxScoreStatValue>,
  event: GameEvent
): void {
  const eventType = ruskiEventTypeById.get(event.type);

  if (eventType === undefined) {
    return;
  }

  if (eventType.id === RUSKI_EVENT_TYPE_IDS.make) {
    incrementStat(stats, RUSKI_STAT_KEYS.makes);
  }

  if (eventType.metadata?.countsAsMiss === true) {
    incrementStat(stats, RUSKI_STAT_KEYS.misses);
  }

  if (
    eventType.statKey !== undefined &&
    eventType.statKey !== RUSKI_STAT_KEYS.makes &&
    eventType.statKey !== RUSKI_STAT_KEYS.misses
  ) {
    incrementStat(stats, eventType.statKey);
  }
}

function incrementStat(
  stats: Record<string, BoxScoreStatValue>,
  statKey: string
): void {
  stats[statKey] = (stats[statKey] ?? 0) + 1;
}

function finalizeRuskiStats(
  stats: Record<string, BoxScoreStatValue>
): Record<string, BoxScoreStatValue> {
  const makes = stats[RUSKI_STAT_KEYS.makes] ?? 0;
  const misses = stats[RUSKI_STAT_KEYS.misses] ?? 0;
  const attempts = makes + misses;

  return {
    ...stats,
    [RUSKI_STAT_KEYS.shootingPercentage]:
      attempts > 0 ? Number((makes / attempts).toFixed(10)) : null
  };
}
