import { ScorebookSchema } from "../../scorebook-schema";
import { RUSKI_GAME_TYPE } from "../definition";
import {
  ruskiScorecardHeaderGroups,
  ruskiScorecardSides
} from "./ruski-scorecard-layout";
import {
  RUSKI_SCOREBOOK_SHEET_NAMES,
  ruskiScorebookSummarySheets
} from "./ruski-scorebook-sheets";

export { RUSKI_SCOREBOOK_SHEET_NAMES } from "./ruski-scorebook-sheets";

export const ruskiScorebookSchema: ScorebookSchema = {
  gameType: RUSKI_GAME_TYPE,
  requiredSheetNames: Object.values(RUSKI_SCOREBOOK_SHEET_NAMES),
  summarySheets: ruskiScorebookSummarySheets,
  blankScorecard: {
    kind: "template",
    sheetName: RUSKI_SCOREBOOK_SHEET_NAMES.blankScorecard,
    statusCell: "B2",
    allowedStatusValues: ["LIVE GAME"],
    sides: ruskiScorecardSides,
    requiredHeaderGroups: ruskiScorecardHeaderGroups
  },
  gameSheets: {
    id: "ruski-game-sheet",
    kind: "game",
    excludeSheetNames: Object.values(RUSKI_SCOREBOOK_SHEET_NAMES),
    requiredHeaderGroups: ruskiScorecardHeaderGroups,
    metadata: {
      statusCell: "B2",
      allowedStatusValues: ["LIVE GAME", "FINAL"],
      sheetNamePattern: "Dynamic matchup sheet names"
    }
  },
  metadata: {
    sourceWorkbook: "docs/2026 Ruski Stat Sheet.xlsx",
    shotRowsPerSide: 80,
    parserReadsOnly: true
  }
};
