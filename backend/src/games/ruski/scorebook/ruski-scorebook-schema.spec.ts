import { findScorebookHeaderMismatches } from "../../scorebook-schema";
import { ruskiGameConfig } from "../config/ruski-game-config";
import {
  RUSKI_SCOREBOOK_SHEET_NAMES,
  ruskiScorebookSchema
} from ".";

describe("Ruski scorebook schema", () => {
  it("enumerates required workbook tabs", () => {
    expect(ruskiScorebookSchema.requiredSheetNames).toEqual([
      RUSKI_SCOREBOOK_SHEET_NAMES.regularSeasonStandings,
      RUSKI_SCOREBOOK_SHEET_NAMES.seasonStats,
      RUSKI_SCOREBOOK_SHEET_NAMES.teamStats,
      RUSKI_SCOREBOOK_SHEET_NAMES.playoffStats,
      RUSKI_SCOREBOOK_SHEET_NAMES.playoffBracket,
      RUSKI_SCOREBOOK_SHEET_NAMES.blankScorecard
    ]);
  });

  it("captures the official blank scorecard layout", () => {
    const [leftSide, rightSide] = ruskiScorebookSchema.blankScorecard.sides;

    expect(ruskiScorebookSchema.blankScorecard).toMatchObject({
      sheetName: "Blank Scorecard",
      statusCell: "B2",
      allowedStatusValues: ["LIVE GAME"]
    });
    expect(leftSide).toMatchObject({
      id: "left",
      shooterLabelCells: ["B3", "B4"],
      playerNameCells: ["C3", "C4"],
      statSummaryValuesRange: {
        start: "D3",
        end: "J4"
      },
      shootingPercentageCells: ["D5", "D6"],
      shotRowsRange: {
        start: "B10",
        end: "J89"
      }
    });
    expect(rightSide).toMatchObject({
      id: "right",
      shooterLabelCells: ["K3", "K4"],
      playerNameCells: ["L3", "L4"],
      statSummaryValuesRange: {
        start: "M3",
        end: "S4"
      },
      shootingPercentageCells: ["M5", "M6"],
      shotRowsRange: {
        start: "K10",
        end: "S89"
      }
    });
  });

  it("uses the official scorecard labels on both game sheet sides", () => {
    const [leftSide, rightSide] = ruskiScorebookSchema.blankScorecard.sides;
    const expectedLabels = [
      "Shot",
      "Shooter",
      "Miss",
      "Make",
      "Splash-Out",
      "Guy",
      "Tri",
      "Di",
      "Vom"
    ];

    expect(leftSide.shotHeaders.map((header) => header.label)).toEqual(
      expectedLabels
    );
    expect(rightSide.shotHeaders.map((header) => header.label)).toEqual(
      expectedLabels
    );
    expect(ruskiGameConfig.scorecardDefinition.columns.map((column) => column.label)).toEqual(
      expectedLabels
    );
  });

  it("defines summary tab header expectations", () => {
    const summarySheetByName = new Map(
      ruskiScorebookSchema.summarySheets.map((sheet) => [sheet.sheetName, sheet])
    );

    expect(summarySheetByName.get("Season Stats")?.headers.map((header) => header.label)).toEqual([
      "Shooter",
      "Shooting",
      "Cups Made",
      "Cups Missed",
      "Splash-Out",
      "Guy",
      "Tri",
      "Di",
      "Un",
      "Vom"
    ]);
    expect(summarySheetByName.get("AllData")?.headers.map((header) => header.label)).toEqual([
      "Game",
      "Player",
      "Miss",
      "Makes",
      "Splash-Out",
      "Guy",
      "Tri",
      "Di",
      "Vom"
    ]);
    expect(summarySheetByName.get("Regular Season Standings")).toMatchObject({
      dataRange: {
        start: "B3",
        end: "L23"
      },
      metadata: {
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
    });
  });

  it("detects renamed or missing scorecard headers for game sheets", () => {
    const workbookCells = createHeaderCellValues();
    workbookCells.F9 = "Splash Out";
    delete workbookCells.R9;

    const mismatches = findScorebookHeaderMismatches(
      ruskiScorebookSchema.gameSheets.requiredHeaderGroups,
      (cell) => workbookCells[cell]
    );

    expect(mismatches).toEqual(
      expect.arrayContaining([
        {
          groupId: "left-shot-rows",
          cell: "F9",
          expected: "Splash-Out",
          actual: "Splash Out",
          reason: "renamed"
        },
        {
          groupId: "right-shot-rows",
          cell: "R9",
          expected: "Di",
          actual: null,
          reason: "missing"
        }
      ])
    );
  });

  it("accepts the expected scorecard headers without mismatches", () => {
    const mismatches = findScorebookHeaderMismatches(
      ruskiScorebookSchema.gameSheets.requiredHeaderGroups,
      (cell) => createHeaderCellValues()[cell]
    );

    expect(mismatches).toEqual([]);
  });
});

function createHeaderCellValues(): Record<string, string> {
  return Object.fromEntries(
    ruskiScorebookSchema.gameSheets.requiredHeaderGroups.flatMap((group) =>
      group.headers.map((header) => [header.cell, header.label])
    )
  );
}
