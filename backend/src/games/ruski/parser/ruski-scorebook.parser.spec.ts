import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ParsedScorebook,
  ParsedScorebookGameSheet,
  ParsedScorebookRow,
  ParsedScorebookSheet
} from "../../parsed-scorebook";
import { RUSKI_EVENT_TYPE_IDS } from "../definition";
import { RUSKI_SCOREBOOK_SHEET_NAMES } from "../scorebook";
import { RuskiScorebookParser } from "./ruski-scorebook.parser";

const fixturePath = join(
  process.cwd(),
  "../docs/2026 Ruski Stat Sheet.xlsx"
);

describe("RuskiScorebookParser", () => {
  it("reads the workbook without changing the source file or buffer", async () => {
    const fileBytesBefore = readFileSync(fixturePath);
    const buffer = Buffer.from(fileBytesBefore);
    const bufferBefore = Buffer.from(buffer);
    const fileHashBefore = hash(fileBytesBefore);

    const parsed = await parseFixture(buffer);

    expect(hash(readFileSync(fixturePath))).toBe(fileHashBefore);
    expect(buffer.equals(bufferBefore)).toBe(true);
    expect(parsed.source).toMatchObject({
      originalName: "2026 Ruski Stat Sheet.xlsx",
      sizeBytes: buffer.byteLength,
      checksum: hash(buffer)
    });
  });

  it("identifies summary, template, game, bracket, and AllData sheets", async () => {
    const parsed = await parseFixture();
    const sheetByName = getSheetByName(parsed);

    expect(parsed.sheets).toHaveLength(63);
    expect(parsed.metadata?.sheetCounts).toMatchObject({
      summary: 4,
      bracket: 1,
      template: 1,
      data: 1,
      game: 56,
      unknown: 0
    });
    expect(sheetByName.get("Regular Season Standings")?.role).toBe("summary");
    expect(sheetByName.get("Season Stats")?.role).toBe("summary");
    expect(sheetByName.get("Team Stats")?.role).toBe("summary");
    expect(sheetByName.get("Playoff Stats")?.role).toBe("summary");
    expect(sheetByName.get("Playoff Bracket (16)")?.role).toBe("bracket");
    expect(sheetByName.get("Blank Scorecard")?.role).toBe("template");
    expect(sheetByName.get("AllData")?.role).toBe("data");
    expect(sheetByName.get("JPShu vs EvHulu")?.role).toBe("game");
  });

  it("extracts player names and box score totals from game sheets", async () => {
    const game = await parseGameSheet("JPShu vs EvHulu");
    const [leftSide, rightSide] = game.sides;

    expect(game.status).toBe("FINAL");
    expect(leftSide.players.map((player) => player.name)).toEqual([
      "Jaden Pearlmutter",
      "Ford Tate"
    ]);
    expect(rightSide.players.map((player) => player.name)).toEqual([
      "Henry Lewis",
      "Everett Schroeder"
    ]);
    expect(leftSide.boxScoreTotals[0]).toMatchObject({
      playerSlot: 1,
      playerName: "Jaden Pearlmutter",
      stats: {
        [RUSKI_EVENT_TYPE_IDS.miss]: 19,
        [RUSKI_EVENT_TYPE_IDS.make]: 4,
        [RUSKI_EVENT_TYPE_IDS.splashOut]: 3,
        [RUSKI_EVENT_TYPE_IDS.guy]: 0,
        [RUSKI_EVENT_TYPE_IDS.tri]: 0,
        [RUSKI_EVENT_TYPE_IDS.di]: 0,
        [RUSKI_EVENT_TYPE_IDS.vom]: 0,
        shootingPercentage: 0.1739130435
      }
    });
    expect(rightSide.boxScoreTotals[1]).toMatchObject({
      playerSlot: 2,
      playerName: "Everett Schroeder",
      stats: {
        [RUSKI_EVENT_TYPE_IDS.miss]: 21,
        [RUSKI_EVENT_TYPE_IDS.make]: 3,
        [RUSKI_EVENT_TYPE_IDS.guy]: 5,
        [RUSKI_EVENT_TYPE_IDS.vom]: 0,
        shootingPercentage: 0.125
      }
    });
  });

  it("extracts shot rows and event flags from both scorecard sides", async () => {
    const game = await parseGameSheet("JPShu vs EvHulu");
    const [leftSide, rightSide] = game.sides;
    const leftFirstShot = leftSide.shotRows[0];
    const rightFirstShot = rightSide.shotRows[0];

    expect(leftSide.shotRows).toHaveLength(80);
    expect(rightSide.shotRows).toHaveLength(80);
    expect(leftFirstShot).toMatchObject({
      rowNumber: 10,
      shotNumber: 1,
      shooterName: "Pearlmutter",
      eventFlags: {
        [RUSKI_EVENT_TYPE_IDS.miss]: true,
        [RUSKI_EVENT_TYPE_IDS.make]: false,
        [RUSKI_EVENT_TYPE_IDS.splashOut]: false,
        [RUSKI_EVENT_TYPE_IDS.guy]: false,
        [RUSKI_EVENT_TYPE_IDS.tri]: false,
        [RUSKI_EVENT_TYPE_IDS.di]: false,
        [RUSKI_EVENT_TYPE_IDS.vom]: false
      }
    });
    expect(rightFirstShot).toMatchObject({
      rowNumber: 10,
      shotNumber: 1,
      shooterName: "Lewis",
      eventFlags: {
        [RUSKI_EVENT_TYPE_IDS.miss]: false,
        [RUSKI_EVENT_TYPE_IDS.make]: true,
        [RUSKI_EVENT_TYPE_IDS.splashOut]: false,
        [RUSKI_EVENT_TYPE_IDS.guy]: false,
        [RUSKI_EVENT_TYPE_IDS.tri]: false,
        [RUSKI_EVENT_TYPE_IDS.di]: false,
        [RUSKI_EVENT_TYPE_IDS.vom]: false
      }
    });
  });

  it("extracts special shot flags from representative game rows", async () => {
    const game = await parseGameSheet("JPShu vs EvHulu");
    const [leftSide, rightSide] = game.sides;

    expect(
      leftSide.shotRows.some(
        (row) => row.eventFlags[RUSKI_EVENT_TYPE_IDS.splashOut]
      )
    ).toBe(true);
    expect(
      rightSide.shotRows.some((row) => row.eventFlags[RUSKI_EVENT_TYPE_IDS.guy])
    ).toBe(true);
  });

  it("normalizes AllData rows from the official fixture", async () => {
    const rows = await parseAllDataRows();

    expect(rows).toHaveLength(226);
    expect(rows[0]).toMatchObject({
      rowNumber: 2,
      values: {
        game: "Regular Season Standings",
        player: "Pierre/Anson",
        misses: 0,
        makes: 7,
        splashOuts: 0,
        guys: 0,
        tris: 1,
        dis: 0,
        voms: 0
      },
      metadata: {
        sourceCells: {
          game: "A2",
          player: "B2",
          misses: "C2",
          makes: "D2",
          splashOuts: "E2",
          guys: "F2",
          tris: "G2",
          dis: "H2",
          voms: "I2"
        }
      }
    });
    expect(rows).toContainEqual(
      expect.objectContaining({
        rowNumber: 8,
        values: expect.objectContaining({
          game: "Brando/Heath vs. Hispanics",
          player: "Heath Lawry",
          misses: 16,
          makes: 5,
          splashOuts: 1,
          guys: 1,
          tris: 0,
          dis: 0,
          voms: 0
        })
      })
    );
    expect(rows.at(-1)?.rowNumber).toBe(227);
    expect(
      rows.some((row) =>
        Object.values(row.values).every((value) => value === null)
      )
    ).toBe(false);
  });
});

async function parseFixture(
  buffer = readFileSync(fixturePath)
): Promise<ParsedScorebook> {
  const parser = new RuskiScorebookParser();

  return parser.parseScorebook({
    buffer,
    originalName: "2026 Ruski Stat Sheet.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: buffer.byteLength
  });
}

async function parseAllDataRows(): Promise<ParsedScorebookRow[]> {
  const parsed = await parseFixture();
  const sheet = getSheetByName(parsed).get(RUSKI_SCOREBOOK_SHEET_NAMES.allData);

  if (sheet?.rows === undefined) {
    throw new Error("Expected AllData to be parsed into normalized rows.");
  }

  return sheet.rows;
}

async function parseGameSheet(
  sheetName: string
): Promise<ParsedScorebookGameSheet> {
  const parsed = await parseFixture();
  const sheet = getSheetByName(parsed).get(sheetName);

  if (sheet?.game === undefined) {
    throw new Error(`Expected ${sheetName} to be parsed as a game sheet.`);
  }

  return sheet.game;
}

function getSheetByName(
  parsed: ParsedScorebook
): Map<string, ParsedScorebookSheet> {
  return new Map(parsed.sheets.map((sheet) => [sheet.name, sheet]));
}

function hash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
