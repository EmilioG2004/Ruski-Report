import {
  GameEvent,
  ScorecardRow,
  TournamentId
} from "../../../domain";
import {
  ParsedScorebookShotRow,
  ParsedScorebookSide
} from "../../parsed-scorebook";
import {
  RUSKI_EVENT_TYPE_IDS,
  RUSKI_GAME_TYPE,
  RUSKI_PHASE_IDS
} from "../definition";
import { RuskiBoxScoreSubject } from "./ruski-box-score";
import { createStableId } from "./ruski-id";
import {
  RuskiTeamDirectory,
  RuskiTeamResolution
} from "./ruski-team-directory";

export interface NormalizedRuskiSide {
  side: ParsedScorebookSide;
  resolution: RuskiTeamResolution;
}

export interface NormalizedRuskiScorecard {
  rows: ScorecardRow[];
  events: GameEvent[];
  subjects: Map<string, RuskiBoxScoreSubject>;
}

export function normalizeRuskiScorecard(
  matchId: string,
  tournamentId: TournamentId,
  normalizedSides: readonly NormalizedRuskiSide[],
  teamDirectory: RuskiTeamDirectory
): NormalizedRuskiScorecard {
  const subjects = new Map<string, RuskiBoxScoreSubject>();
  const events: GameEvent[] = [];
  let sequence = 1;

  const rows = normalizedSides.flatMap(({ side, resolution }) => {
    resolution.team.players.forEach((player) => {
      subjects.set(player.id, {
        label: player.displayName,
        playerId: player.id,
        teamId: resolution.team.id
      });
    });

    return side.shotRows.map((shotRow) => {
      const playerId = teamDirectory.resolveShooter(
        resolution.team.id,
        shotRow.shooterName
      );
      const rowEvents = createShotRowEvents(
        matchId,
        tournamentId,
        side,
        resolution,
        shotRow,
        playerId,
        events.length
      );

      events.push(...rowEvents);

      return {
        id: createStableId("scorecard-row", `${matchId}-${side.id}-${sequence}`),
        matchId,
        sequence: sequence++,
        phaseId: RUSKI_PHASE_IDS.normal,
        teamId: resolution.team.id,
        playerId,
        values: createScorecardValues(shotRow),
        eventIds: rowEvents.map((event) => event.id),
        metadata: {
          sideId: side.id
        }
      };
    });
  });

  return {
    rows,
    events,
    subjects
  };
}

function createShotRowEvents(
  matchId: string,
  tournamentId: TournamentId,
  side: ParsedScorebookSide,
  resolution: RuskiTeamResolution,
  shotRow: ParsedScorebookShotRow,
  playerId: string | undefined,
  existingEventCount: number
): GameEvent[] {
  return getNormalizedEventTypes(shotRow).map(
    (eventType, eventIndex): GameEvent => ({
      id: createStableId(
        "event",
        `${matchId}-${side.id}-${shotRow.rowNumber}-${eventIndex + 1}`
      ),
      matchId,
      tournamentId,
      gameType: RUSKI_GAME_TYPE,
      type: eventType,
      sequence: existingEventCount + eventIndex + 1,
      phaseId: RUSKI_PHASE_IDS.normal,
      teamId: resolution.team.id,
      playerId,
      metadata: {
        sideId: side.id,
        shotNumber: shotRow.shotNumber,
        shooterName: shotRow.shooterName
      }
    })
  );
}

function createScorecardValues(shotRow: ParsedScorebookShotRow) {
  return {
    shotNumber: shotRow.shotNumber,
    shooter: shotRow.shooterName,
    miss: getFlag(shotRow, RUSKI_EVENT_TYPE_IDS.miss),
    make: getFlag(shotRow, RUSKI_EVENT_TYPE_IDS.make),
    splashOut: getFlag(shotRow, RUSKI_EVENT_TYPE_IDS.splashOut),
    guy: getFlag(shotRow, RUSKI_EVENT_TYPE_IDS.guy),
    tri: getFlag(shotRow, RUSKI_EVENT_TYPE_IDS.tri),
    di: getFlag(shotRow, RUSKI_EVENT_TYPE_IDS.di),
    vom: getFlag(shotRow, RUSKI_EVENT_TYPE_IDS.vom)
  };
}

function getNormalizedEventTypes(row: ParsedScorebookShotRow): string[] {
  const events: string[] = [];
  const hasMake = getFlag(row, RUSKI_EVENT_TYPE_IDS.make);

  if (hasMake) {
    events.push(RUSKI_EVENT_TYPE_IDS.make);
  }

  if (!hasMake) {
    const specialMiss = [
      RUSKI_EVENT_TYPE_IDS.di,
      RUSKI_EVENT_TYPE_IDS.tri,
      RUSKI_EVENT_TYPE_IDS.guy,
      RUSKI_EVENT_TYPE_IDS.splashOut
    ].find((eventId) => getFlag(row, eventId));

    if (specialMiss !== undefined) {
      events.push(specialMiss);
    } else if (getFlag(row, RUSKI_EVENT_TYPE_IDS.miss)) {
      events.push(RUSKI_EVENT_TYPE_IDS.miss);
    }
  }

  if (getFlag(row, RUSKI_EVENT_TYPE_IDS.vom)) {
    events.push(RUSKI_EVENT_TYPE_IDS.vom);
  }

  return events;
}

function getFlag(row: ParsedScorebookShotRow, eventId: string): boolean {
  return row.eventFlags[eventId] ?? false;
}
