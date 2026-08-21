/**
 * Coordinates scorecard normalization after a game sheet has been resolved to
 * canonical teams. Turn ordering and shot artifact creation remain isolated so
 * this service only owns orchestration and subject registration.
 */

import { GameEvent, ScorecardRow, TournamentId } from "../../../domain";
import { RuskiBoxScoreSubject } from "./ruski-box-score";
import { createRuskiShotArtifacts } from "./ruski-shot-artifact.factory";
import { RuskiTeamDirectory } from "./ruski-team-directory";
import {
  orderRuskiShotsByTurn,
  ResolvedRuskiScorecardSide
} from "./ruski-turn-order";

export interface NormalizedRuskiScorecard {
  rows: ScorecardRow[];
  events: GameEvent[];
  subjects: Map<string, RuskiBoxScoreSubject>;
}

export function normalizeRuskiScorecard(
  matchId: string,
  tournamentId: TournamentId,
  resolvedSides: readonly ResolvedRuskiScorecardSide[],
  teamDirectory: RuskiTeamDirectory
): NormalizedRuskiScorecard {
  const subjects = createSubjects(resolvedSides, teamDirectory);
  const events: GameEvent[] = [];
  const rows = orderRuskiShotsByTurn(resolvedSides).map(
    (orderedShot, rowIndex) => {
      const playerId = teamDirectory.resolveShooter(
        orderedShot.resolution.team.id,
        orderedShot.shotRow.shooterName
      );
      const artifacts = createRuskiShotArtifacts({
        ...orderedShot,
        matchId,
        tournamentId,
        rowSequence: rowIndex + 1,
        eventSequenceStart: events.length,
        playerId
      });

      events.push(...artifacts.events);
      return artifacts.row;
    }
  );

  return { rows, events, subjects };
}

function createSubjects(
  resolvedSides: readonly ResolvedRuskiScorecardSide[],
  teamDirectory: RuskiTeamDirectory
): Map<string, RuskiBoxScoreSubject> {
  const subjects = new Map<string, RuskiBoxScoreSubject>();

  resolvedSides.forEach(({ resolution }) => {
    resolution.playerIds.forEach((playerId) => {
      const player = teamDirectory.getPlayer(playerId);

      subjects.set(playerId, {
        label: player?.displayName ?? playerId,
        playerId,
        teamId: resolution.team.id
      });
    });
  });

  return subjects;
}
