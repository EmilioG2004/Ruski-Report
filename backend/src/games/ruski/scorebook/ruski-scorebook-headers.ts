import { ScorebookHeaderCell } from "../../scorebook-schema";
import { RUSKI_EVENT_TYPE_IDS } from "../definition";

export const ruskiScorecardStatHeaders = [
  {
    key: RUSKI_EVENT_TYPE_IDS.miss,
    label: "Miss"
  },
  {
    key: RUSKI_EVENT_TYPE_IDS.make,
    label: "Make"
  },
  {
    key: RUSKI_EVENT_TYPE_IDS.splashOut,
    label: "Splash-Out"
  },
  {
    key: RUSKI_EVENT_TYPE_IDS.guy,
    label: "Guy"
  },
  {
    key: RUSKI_EVENT_TYPE_IDS.tri,
    label: "Tri"
  },
  {
    key: RUSKI_EVENT_TYPE_IDS.di,
    label: "Di"
  },
  {
    key: RUSKI_EVENT_TYPE_IDS.vom,
    label: "Vom"
  }
] as const;

export const ruskiScorecardShotHeaders = [
  {
    key: "shotNumber",
    label: "Shot"
  },
  {
    key: "shooter",
    label: "Shooter"
  },
  ...ruskiScorecardStatHeaders
] as const;

export const ruskiPlayerStatHeaders = [
  {
    key: "name",
    label: "Shooter"
  },
  {
    key: "shootingPercentage",
    label: "Shooting"
  },
  {
    key: "makes",
    label: "Cups Made"
  },
  {
    key: "misses",
    label: "Cups Missed"
  },
  {
    key: "splashOuts",
    label: "Splash-Out"
  },
  {
    key: "guys",
    label: "Guy"
  },
  {
    key: "tris",
    label: "Tri"
  },
  {
    key: "dis",
    label: "Di"
  },
  {
    key: "uns",
    label: "Un"
  },
  {
    key: "voms",
    label: "Vom"
  }
] as const;

export const ruskiTeamStatHeaders = [
  {
    key: "team",
    label: "Team"
  },
  ...ruskiPlayerStatHeaders.slice(1)
] as const;

export const ruskiAllDataHeaders = [
  {
    key: "game",
    label: "Game"
  },
  {
    key: "player",
    label: "Player"
  },
  {
    key: "misses",
    label: "Miss"
  },
  {
    key: "makes",
    label: "Makes"
  },
  {
    key: "splashOuts",
    label: "Splash-Out"
  },
  {
    key: "guys",
    label: "Guy"
  },
  {
    key: "tris",
    label: "Tri"
  },
  {
    key: "dis",
    label: "Di"
  },
  {
    key: "voms",
    label: "Vom"
  }
] as const;

export function createHeaderCells(
  headers: ReadonlyArray<{ key: string; label: string }>,
  cells: readonly string[]
): ScorebookHeaderCell[] {
  if (headers.length !== cells.length) {
    throw new Error("Scorebook header definitions must match cell addresses.");
  }

  return headers.map((header, index) => ({
    ...header,
    cell: cells[index],
    required: true
  }));
}
