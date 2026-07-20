import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ParsedScorebook,
  ParsedScorebookSheet,
  ParsedScorebookSide
} from "../../parsed-scorebook";
import { RUSKI_EVENT_TYPE_IDS } from "../definition";
import { RUSKI_SCOREBOOK_SHEET_NAMES } from "../scorebook";
import { RuskiScorebookParser } from "../parser";
import { RuskiScorebookValidator } from "./ruski-scorebook.validator";

const fixturePath = join(
  process.cwd(),
  "../docs/2026 Ruski Stat Sheet.xlsx"
);

describe("RuskiScorebookValidator", () => {
  it("accepts the official Ruski scorebook fixture", async () => {
    const parsed = await parseFixture();
    const validator = new RuskiScorebookValidator();

    expect(validator.validateScorebook(parsed)).toEqual({
      valid: true,
      errors: [],
      warnings: []
    });
  });

  it("reports missing required tabs clearly", async () => {
    const parsed = await parseFixture();
    parsed.sheets = parsed.sheets.filter(
      (sheet) =>
        sheet.name !== RUSKI_SCOREBOOK_SHEET_NAMES.regularSeasonStandings
    );

    const result = new RuskiScorebookValidator().validateScorebook(parsed);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "MISSING_REQUIRED_SHEET",
        message:
          "Required Ruski scorebook sheet 'Regular Season Standings' is missing.",
        path: "sheets.Regular Season Standings",
        metadata: {
          sheetName: "Regular Season Standings"
        }
      })
    );
  });

  it("reports changed scorecard headers clearly", () => {
    const parsed = createMinimalParsedScorebook([
      {
        name: "Bad Game",
        index: 0,
        role: "unknown",
        metadata: {
          headerMismatches: [
            {
              groupId: "left-shot-rows",
              cell: "B9",
              expected: "Shot",
              actual: "Attempt",
              reason: "renamed"
            }
          ]
        }
      }
    ]);

    const result = new RuskiScorebookValidator().validateScorebook(parsed);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "SCORECARD_HEADER_MISMATCH",
        message: "Expected 'Shot' in B9 on 'Bad Game' but found 'Attempt'.",
        path: "sheets.Bad Game.B9"
      })
    );
  });

  it("reports invalid event row combinations", async () => {
    const parsed = await parseFixture();
    const side = getFirstGameSide(parsed);
    side.shotRows[0].eventFlags[RUSKI_EVENT_TYPE_IDS.make] = true;

    const result = new RuskiScorebookValidator().validateScorebook(parsed);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "INVALID_EVENT_COMBINATION",
        path: expect.stringContaining(".eventFlags")
      })
    );
  });

  it("reports shot row totals that do not match box score totals", async () => {
    const parsed = await parseFixture();
    const side = getFirstGameSide(parsed);
    const total = side.boxScoreTotals[0];
    total.stats[RUSKI_EVENT_TYPE_IDS.make] =
      (total.stats[RUSKI_EVENT_TYPE_IDS.make] ?? 0) + 1;

    const result = new RuskiScorebookValidator().validateScorebook(parsed);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "STAT_TOTAL_MISMATCH",
        path: expect.stringContaining(
          `.boxScoreTotals.${RUSKI_EVENT_TYPE_IDS.make}`
        )
      })
    );
  });

  it("reports cross-sheet team identity mismatches", async () => {
    const parsed = await parseFixture();
    const teamStats = parsed.sheets.find(
      (sheet) => sheet.name === RUSKI_SCOREBOOK_SHEET_NAMES.teamStats
    );

    if (teamStats?.rows?.[0] === undefined) {
      throw new Error("Expected parsed Team Stats rows.");
    }
    teamStats.rows[0].values.shootingPercentage = 0.999;

    const result = new RuskiScorebookValidator().validateScorebook(parsed);

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "TEAM_STAT_IDENTITY_MISMATCH",
        path: "sheets.Team Stats.rows"
      })
    );
  });

  it("reports malformed bracket round topology", async () => {
    const parsed = await parseFixture();
    const bracket = parsed.sheets.find(
      (sheet) => sheet.name === RUSKI_SCOREBOOK_SHEET_NAMES.playoffBracket
    );

    if (bracket?.rows === undefined) {
      throw new Error("Expected parsed playoff bracket rows.");
    }
    bracket.rows = bracket.rows.filter(
      (row) =>
        row.values.bracketMatchId !== "sweet-16-1" ||
        row.values.slotSequence !== 1
    );

    const result = new RuskiScorebookValidator().validateScorebook(parsed);

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "INVALID_BRACKET_ROUND_SIZE",
        path: "sheets.Playoff Bracket (16).rounds.sweet-16"
      })
    );
  });
});

async function parseFixture(): Promise<ParsedScorebook> {
  const buffer = readFileSync(fixturePath);

  return new RuskiScorebookParser().parseScorebook({
    buffer,
    originalName: "2026 Ruski Stat Sheet.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: buffer.byteLength
  });
}

function createMinimalParsedScorebook(
  extraSheets: ParsedScorebookSheet[]
): ParsedScorebook {
  return {
    gameType: "ruski",
    source: {
      originalName: "minimal.xlsx"
    },
    sheets: [
      ...Object.values(RUSKI_SCOREBOOK_SHEET_NAMES).map(
        (sheetName, index): ParsedScorebookSheet => ({
          name: sheetName,
          index,
          role: sheetName === RUSKI_SCOREBOOK_SHEET_NAMES.allData ? "data" : "summary"
        })
      ),
      ...extraSheets
    ]
  };
}

function getFirstGameSide(parsed: ParsedScorebook): ParsedScorebookSide {
  const side = parsed.sheets.find((sheet) => sheet.role === "game")?.game
    ?.sides[0];

  if (side === undefined) {
    throw new Error("Expected fixture to include at least one parsed game side.");
  }

  return side;
}
