/**
 * Projects mirrored scorebook sides into game chronology. The first scorebook
 * side owns first possession, then each numbered turn alternates through the
 * remaining sides while preserving shooter order within a team turn.
 */

import {
  ParsedScorebookShotRow,
  ParsedScorebookSide
} from "../../parsed-scorebook";
import { RuskiTeamResolution } from "./ruski-team-directory";

export interface ResolvedRuskiScorecardSide {
  side: ParsedScorebookSide;
  resolution: RuskiTeamResolution;
}

export interface OrderedRuskiShot {
  side: ParsedScorebookSide;
  resolution: RuskiTeamResolution;
  shotRow: ParsedScorebookShotRow;
  turnNumber: number;
  teamTurnOrder: number;
  shotInTeamTurn: number;
}

export function orderRuskiShotsByTurn(
  resolvedSides: readonly ResolvedRuskiScorecardSide[]
): OrderedRuskiShot[] {
  const sideTurns = resolvedSides.map(({ side, resolution }) => ({
    side,
    resolution,
    turns: groupActiveRowsByTurn(side.shotRows)
  }));
  const turnNumbers = Array.from(
    new Set(sideTurns.flatMap(({ turns }) => Array.from(turns.keys())))
  ).sort((first, second) => first - second);

  return turnNumbers.flatMap((turnNumber) =>
    sideTurns.flatMap(({ side, resolution, turns }, sideIndex) =>
      (turns.get(turnNumber) ?? []).map((shotRow, shotIndex) => ({
        side,
        resolution,
        shotRow,
        turnNumber,
        teamTurnOrder: sideIndex + 1,
        shotInTeamTurn: shotIndex + 1
      }))
    )
  );
}

function groupActiveRowsByTurn(
  rows: readonly ParsedScorebookShotRow[]
): Map<number, ParsedScorebookShotRow[]> {
  const turns = new Map<number, ParsedScorebookShotRow[]>();

  trimTrailingTemplateRows(rows).forEach((row, rowIndex) => {
    const turnNumber = row.shotNumber ?? Math.floor(rowIndex / 2) + 1;
    const existingRows = turns.get(turnNumber) ?? [];

    existingRows.push(row);
    turns.set(turnNumber, existingRows);
  });

  return turns;
}

function trimTrailingTemplateRows(
  rows: readonly ParsedScorebookShotRow[]
): readonly ParsedScorebookShotRow[] {
  let lastRecordedIndex = -1;

  rows.forEach((row, index) => {
    if (Object.values(row.eventFlags).some(Boolean)) {
      lastRecordedIndex = index;
    }
  });

  return lastRecordedIndex < 0 ? [] : rows.slice(0, lastRecordedIndex + 1);
}
