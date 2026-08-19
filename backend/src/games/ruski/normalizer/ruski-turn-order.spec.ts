/**
 * Protects the scorebook-side chronology contract independently of workbook
 * parsing and team identity resolution.
 */

import {
  ParsedScorebookShotRow,
  ParsedScorebookSide
} from "../../parsed-scorebook";
import { RuskiTeamResolution } from "./ruski-team-directory";
import { orderRuskiShotsByTurn } from "./ruski-turn-order";

describe("orderRuskiShotsByTurn", () => {
  it("alternates team turns and keeps both shooters together", () => {
    const ordered = orderRuskiShotsByTurn([
      resolvedSide("left", "team-left"),
      resolvedSide("right", "team-right")
    ]);

    expect(
      ordered.map((shot) => ({
        row: shot.shotRow.rowNumber,
        teamId: shot.resolution.team.id,
        turn: shot.turnNumber,
        teamOrder: shot.teamTurnOrder,
        shotOrder: shot.shotInTeamTurn
      }))
    ).toEqual([
      { row: 10, teamId: "team-left", turn: 1, teamOrder: 1, shotOrder: 1 },
      { row: 11, teamId: "team-left", turn: 1, teamOrder: 1, shotOrder: 2 },
      { row: 10, teamId: "team-right", turn: 1, teamOrder: 2, shotOrder: 1 },
      { row: 11, teamId: "team-right", turn: 1, teamOrder: 2, shotOrder: 2 },
      { row: 12, teamId: "team-left", turn: 2, teamOrder: 1, shotOrder: 1 },
      { row: 13, teamId: "team-left", turn: 2, teamOrder: 1, shotOrder: 2 },
      { row: 12, teamId: "team-right", turn: 2, teamOrder: 2, shotOrder: 1 },
      { row: 13, teamId: "team-right", turn: 2, teamOrder: 2, shotOrder: 2 }
    ]);
  });

  it("removes trailing template turns but preserves internal blank shots", () => {
    const ordered = orderRuskiShotsByTurn([
      resolvedSide("left", "team-left"),
      resolvedSide("right", "team-right")
    ]);

    expect(ordered.some((shot) => shot.shotRow.rowNumber === 11)).toBe(true);
    expect(ordered.some((shot) => shot.shotRow.rowNumber >= 14)).toBe(false);
  });
});

function resolvedSide(sideId: string, teamId: string): {
  side: ParsedScorebookSide;
  resolution: RuskiTeamResolution;
} {
  return {
    side: {
      id: sideId,
      label: sideId,
      players: [],
      boxScoreTotals: [],
      shotRows: [
        shotRow(10, 1, true),
        shotRow(11, 1, false),
        shotRow(12, 2, true),
        shotRow(13, 2, true),
        shotRow(14, 3, false),
        shotRow(15, 3, false)
      ]
    },
    resolution: {
      team: {
        id: teamId,
        tournamentId: "tournament-test",
        name: teamId,
        players: []
      },
      playerIds: []
    }
  };
}

function shotRow(
  rowNumber: number,
  shotNumber: number,
  isRecorded: boolean
): ParsedScorebookShotRow {
  return {
    rowNumber,
    shotNumber,
    shooterName: `Shooter ${rowNumber % 2}`,
    eventFlags: { miss: isRecorded },
    sourceCells: {}
  };
}
