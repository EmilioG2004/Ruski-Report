import {
  ScorebookHeaderGroup,
  ScorebookSideSchema
} from "../../scorebook-schema";
import {
  createHeaderCells,
  ruskiScorecardShotHeaders,
  ruskiScorecardStatHeaders
} from "./ruski-scorebook-headers";

export const ruskiLeftStatHeaders = createHeaderCells(
  ruskiScorecardStatHeaders,
  ["D2", "E2", "F2", "G2", "H2", "I2", "J2"]
);

export const ruskiRightStatHeaders = createHeaderCells(
  ruskiScorecardStatHeaders,
  ["M2", "N2", "O2", "P2", "Q2", "R2", "S2"]
);

export const ruskiLeftShotHeaders = createHeaderCells(
  ruskiScorecardShotHeaders,
  ["B9", "C9", "D9", "E9", "F9", "G9", "H9", "I9", "J9"]
);

export const ruskiRightShotHeaders = createHeaderCells(
  ruskiScorecardShotHeaders,
  ["K9", "L9", "M9", "N9", "O9", "P9", "Q9", "R9", "S9"]
);

export const ruskiScorecardHeaderGroups: ScorebookHeaderGroup[] = [
  {
    id: "left-stat-summary",
    label: "Left team stat summary headers",
    headers: ruskiLeftStatHeaders
  },
  {
    id: "right-stat-summary",
    label: "Right team stat summary headers",
    headers: ruskiRightStatHeaders
  },
  {
    id: "left-shot-rows",
    label: "Left team shot row headers",
    headers: ruskiLeftShotHeaders
  },
  {
    id: "right-shot-rows",
    label: "Right team shot row headers",
    headers: ruskiRightShotHeaders
  }
];

export const ruskiScorecardSides: ScorebookSideSchema[] = [
  {
    id: "left",
    label: "Left Team",
    shooterLabelCells: ["B3", "B4"],
    playerNameCells: ["C3", "C4"],
    statSummaryHeaders: ruskiLeftStatHeaders,
    statSummaryValuesRange: {
      start: "D3",
      end: "J4"
    },
    shootingPercentageCells: ["D5", "D6"],
    shotHeaders: ruskiLeftShotHeaders,
    shotRowsRange: {
      start: "B10",
      end: "J89"
    }
  },
  {
    id: "right",
    label: "Right Team",
    shooterLabelCells: ["K3", "K4"],
    playerNameCells: ["L3", "L4"],
    statSummaryHeaders: ruskiRightStatHeaders,
    statSummaryValuesRange: {
      start: "M3",
      end: "S4"
    },
    shootingPercentageCells: ["M5", "M6"],
    shotHeaders: ruskiRightShotHeaders,
    shotRowsRange: {
      start: "K10",
      end: "S89"
    }
  }
];
