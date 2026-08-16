import { ScorebookSummarySheetSchema } from "../../scorebook-schema";
import {
  createHeaderCells,
  ruskiAllDataHeaders,
  ruskiPlayerStatHeaders,
  ruskiTeamStatHeaders
} from "./ruski-scorebook-headers";

export const RUSKI_SCOREBOOK_SHEET_NAMES = {
  regularSeasonStandings: "Regular Season Standings",
  seasonStats: "Season Stats",
  teamStats: "Team Stats",
  playoffStats: "Playoff Stats",
  playoffBracket: "Playoff Bracket (16)",
  blankScorecard: "Blank Scorecard",
  allData: "AllData"
} as const;

const regularSeasonStandingHeaders = [
  {
    key: "leftSeed",
    label: "Seed",
    cell: "B2"
  },
  {
    key: "leftPod",
    label: "Pod A",
    cell: "C2"
  },
  {
    key: "leftRecord",
    label: "Record",
    cell: "D2"
  },
  {
    key: "leftCupDifferential",
    label: "Cup Diff",
    cell: "E2"
  },
  {
    key: "leftShootingPercentage",
    label: "Shooting %",
    cell: "F2"
  },
  {
    key: "rightSeed",
    label: "Seed",
    cell: "H2"
  },
  {
    key: "rightPod",
    label: "Pod E",
    cell: "I2"
  },
  {
    key: "rightRecord",
    label: "Record",
    cell: "J2"
  },
  {
    key: "rightCupDifferential",
    label: "Cup Diff",
    cell: "K2"
  },
  {
    key: "rightShootingPercentage",
    label: "Shooting %",
    cell: "L2"
  }
] as const;

const playoffBracketHeaders = [
  {
    key: "sweet16Left",
    label: "Sweet 16",
    cell: "B1"
  },
  {
    key: "elite8Left",
    label: "Elite 8",
    cell: "E1"
  },
  {
    key: "final4Left",
    label: "Final 4",
    cell: "H1"
  },
  {
    key: "championship",
    label: "Championship",
    cell: "K1"
  },
  {
    key: "final4Right",
    label: "Final 4",
    cell: "M1"
  },
  {
    key: "elite8Right",
    label: "Elite 8",
    cell: "P1"
  },
  {
    key: "sweet16Right",
    label: "Sweet 16",
    cell: "S1"
  }
] as const;

export const ruskiScorebookSummarySheets: ScorebookSummarySheetSchema[] = [
  {
    sheetName: RUSKI_SCOREBOOK_SHEET_NAMES.regularSeasonStandings,
    kind: "summary",
    required: true,
    headerRow: 2,
    headers: regularSeasonStandingHeaders,
    dataRange: {
      start: "B3",
      end: "L23"
    },
    metadata: {
      podNameCells: ["C2", "I2", "C8", "I8", "C14", "I14", "C20", "I20"],
      expectedPodNames: [
        "Pod A",
        "Pod B",
        "Pod C",
        "Pod D",
        "Pod E",
        "Pod F",
        "Pod G",
        "Pod H"
      ]
    }
  },
  createStatSummarySheet(
    RUSKI_SCOREBOOK_SHEET_NAMES.seasonStats,
    "summary",
    ruskiPlayerStatHeaders,
    "B3",
    "K200"
  ),
  createStatSummarySheet(
    RUSKI_SCOREBOOK_SHEET_NAMES.teamStats,
    "summary",
    ruskiTeamStatHeaders,
    "B3",
    "K80"
  ),
  createStatSummarySheet(
    RUSKI_SCOREBOOK_SHEET_NAMES.playoffStats,
    "summary",
    ruskiPlayerStatHeaders,
    "B3",
    "K120"
  ),
  {
    sheetName: RUSKI_SCOREBOOK_SHEET_NAMES.playoffBracket,
    kind: "bracket",
    required: true,
    headerRow: 1,
    headers: playoffBracketHeaders,
    dataRange: {
      start: "B1",
      end: "T24"
    }
  },
  {
    sheetName: RUSKI_SCOREBOOK_SHEET_NAMES.allData,
    kind: "data",
    required: false,
    headerRow: 1,
    headers: createHeaderCells(ruskiAllDataHeaders, [
      "A1",
      "B1",
      "C1",
      "D1",
      "E1",
      "F1",
      "G1",
      "H1",
      "I1"
    ]),
    dataRange: {
      start: "A2",
      end: "I5000"
    }
  }
];

function createStatSummarySheet(
  sheetName: string,
  kind: "summary",
  headers: ReadonlyArray<{ key: string; label: string }>,
  start: string,
  end: string
): ScorebookSummarySheetSchema {
  return {
    sheetName,
    kind,
    required: true,
    headerRow: 2,
    headers: createHeaderCells(headers, [
      "B2",
      "C2",
      "D2",
      "E2",
      "F2",
      "G2",
      "H2",
      "I2",
      "J2",
      "K2"
    ]),
    dataRange: {
      start,
      end
    }
  };
}
