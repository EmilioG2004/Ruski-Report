/**
 * Builds the generic scorecard row and its domain events from one ordered
 * Ruski shot. Keeping artifact creation together prevents their chronology
 * metadata and identifiers from drifting apart.
 */

import {
  GameEvent,
  ScorecardCellValue,
  ScorecardRow,
  TournamentId
} from "../../../domain";
import {
  RUSKI_EVENT_TYPE_IDS,
  RUSKI_GAME_TYPE,
  RUSKI_PHASE_IDS,
  RUSKI_TURN_METADATA_KEYS
} from "../definition";
import { createStableId } from "./ruski-id";
import { OrderedRuskiShot } from "./ruski-turn-order";

interface RuskiShotArtifactContext extends OrderedRuskiShot {
  matchId: string;
  tournamentId: TournamentId;
  rowSequence: number;
  eventSequenceStart: number;
  playerId: string | undefined;
}

export interface RuskiShotArtifacts {
  row: ScorecardRow;
  events: GameEvent[];
}

export function createRuskiShotArtifacts(
  context: RuskiShotArtifactContext
): RuskiShotArtifacts {
  const events = createEvents(context);
  const metadata = {
    [RUSKI_TURN_METADATA_KEYS.sideId]: context.side.id,
    [RUSKI_TURN_METADATA_KEYS.turnNumber]: context.turnNumber,
    [RUSKI_TURN_METADATA_KEYS.teamTurnOrder]: context.teamTurnOrder,
    [RUSKI_TURN_METADATA_KEYS.shotInTeamTurn]: context.shotInTeamTurn
  };

  return {
    row: {
      id: createStableId(
        "scorecard-row",
        `${context.matchId}-${context.side.id}-${context.shotRow.rowNumber}`
      ),
      matchId: context.matchId,
      sequence: context.rowSequence,
      phaseId: RUSKI_PHASE_IDS.normal,
      teamId: context.resolution.team.id,
      playerId: context.playerId,
      values: createScorecardValues(context),
      eventIds: events.map((event) => event.id),
      metadata
    },
    events
  };
}

function createEvents(context: RuskiShotArtifactContext): GameEvent[] {
  return getNormalizedEventTypes(context).map((eventType, eventIndex) => ({
    id: createStableId(
      "event",
      `${context.matchId}-${context.side.id}-${context.shotRow.rowNumber}-${eventIndex + 1}`
    ),
    matchId: context.matchId,
    tournamentId: context.tournamentId,
    gameType: RUSKI_GAME_TYPE,
    type: eventType,
    sequence: context.eventSequenceStart + eventIndex + 1,
    phaseId: RUSKI_PHASE_IDS.normal,
    teamId: context.resolution.team.id,
    playerId: context.playerId,
    metadata: {
      [RUSKI_TURN_METADATA_KEYS.sideId]: context.side.id,
      [RUSKI_TURN_METADATA_KEYS.turnNumber]: context.turnNumber,
      [RUSKI_TURN_METADATA_KEYS.teamTurnOrder]: context.teamTurnOrder,
      [RUSKI_TURN_METADATA_KEYS.shotInTeamTurn]: context.shotInTeamTurn,
      shotNumber: context.shotRow.shotNumber,
      shooterName: context.shotRow.shooterName
    }
  }));
}

function createScorecardValues(
  context: RuskiShotArtifactContext
): Record<string, ScorecardCellValue> {
  const { shotRow } = context;

  return {
    shotNumber: shotRow.shotNumber,
    shooter: shotRow.shooterName,
    miss: getFlag(context, RUSKI_EVENT_TYPE_IDS.miss),
    make: getFlag(context, RUSKI_EVENT_TYPE_IDS.make),
    splashOut: getFlag(context, RUSKI_EVENT_TYPE_IDS.splashOut),
    guy: getFlag(context, RUSKI_EVENT_TYPE_IDS.guy),
    tri: getFlag(context, RUSKI_EVENT_TYPE_IDS.tri),
    di: getFlag(context, RUSKI_EVENT_TYPE_IDS.di),
    vom: getFlag(context, RUSKI_EVENT_TYPE_IDS.vom)
  };
}

function getNormalizedEventTypes(context: RuskiShotArtifactContext): string[] {
  const hasMake = getFlag(context, RUSKI_EVENT_TYPE_IDS.make);
  const events = hasMake ? [RUSKI_EVENT_TYPE_IDS.make] : getMissEvents(context);

  if (getFlag(context, RUSKI_EVENT_TYPE_IDS.vom)) {
    events.push(RUSKI_EVENT_TYPE_IDS.vom);
  }

  return events;
}

function getMissEvents(context: RuskiShotArtifactContext): string[] {
  const specialMiss = [
    RUSKI_EVENT_TYPE_IDS.di,
    RUSKI_EVENT_TYPE_IDS.tri,
    RUSKI_EVENT_TYPE_IDS.guy,
    RUSKI_EVENT_TYPE_IDS.splashOut
  ].find((eventId) => getFlag(context, eventId));

  if (specialMiss !== undefined) {
    return [specialMiss];
  }

  return getFlag(context, RUSKI_EVENT_TYPE_IDS.miss)
    ? [RUSKI_EVENT_TYPE_IDS.miss]
    : [];
}

function getFlag(context: RuskiShotArtifactContext, eventId: string): boolean {
  return context.shotRow.eventFlags[eventId] ?? false;
}
