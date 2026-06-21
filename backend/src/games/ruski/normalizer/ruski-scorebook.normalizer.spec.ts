import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ParsedScorebook } from "../../parsed-scorebook";
import { RUSKI_EVENT_TYPE_IDS, RUSKI_STAT_KEYS } from "../definition";
import { RUSKI_SCOREBOOK_SHEET_NAMES } from "../scorebook";
import { RuskiScorebookParser } from "../parser";
import { RuskiScorebookNormalizer } from "./ruski-scorebook.normalizer";

const fixturePath = join(
  process.cwd(),
  "../docs/2026 Ruski Stat Sheet.xlsx"
);

describe("RuskiScorebookNormalizer", () => {
  it("normalizes game sheets into a tournament snapshot without requiring AllData", async () => {
    const parsed = await parseFixture();
    parsed.sheets = parsed.sheets.filter(
      (sheet) => sheet.name !== RUSKI_SCOREBOOK_SHEET_NAMES.allData
    );

    const snapshot = await normalizeFixture(parsed);
    const gameSheetCount = parsed.sheets.filter((sheet) => sheet.role === "game")
      .length;

    expect(snapshot.validation.valid).toBe(true);
    expect(snapshot.matches).toHaveLength(gameSheetCount);
    expect(snapshot.tournament.matchSummaries).toHaveLength(gameSheetCount);
    expect(snapshot.tournament.teams.length).toBeGreaterThan(0);
    expect(snapshot.tournament.metadata).toMatchObject({
      normalizedFrom: "ruski-game-sheets",
      allDataRequired: false
    });
  });

  it("uses season-confirmed teams when matching game sheet sides", async () => {
    const snapshot = await normalizeFixture(await parseFixture());
    const match = snapshot.matches.find((candidate) => {
      return candidate.id === "match-jpshu-vs-evhulu";
    });

    expect(match?.participants.map((participant) => participant.teamId)).toEqual(
      expect.arrayContaining(["team-jp-shu", "team-ev-hulu"])
    );
    expect(
      snapshot.tournament.teams.find((team) => team.id === "team-jp-shu")
    ).toMatchObject({
      name: "JP/Shu",
      metadata: {
        source: "season-confirmed-team"
      }
    });
  });

  it("creates match detail scorecards and events from game sheets", async () => {
    const snapshot = await normalizeFixture(await parseFixture());
    const match = snapshot.matches.find((candidate) => {
      return candidate.id === "match-jpshu-vs-evhulu";
    });

    expect(match).toBeDefined();
    expect(match?.metadata).toMatchObject({
      sourceSheetName: "JPShu vs EvHulu"
    });
    expect(match?.participants).toHaveLength(2);
    expect(match?.scorecard.definition.id).toBe("ruski-scorecard");
    expect(match?.scorecard.rows).toHaveLength(160);
    expect(match?.events.length).toBeGreaterThan(0);
    expect(match?.boxScore.rows.length).toBeGreaterThan(0);
  });

  it("counts fixture special misses in normalized box scores", async () => {
    const snapshot = await normalizeFixture(await parseFixture());
    const events = snapshot.matches.flatMap((match) => match.events);
    const matchWithSpecialMiss = snapshot.matches.find((match) => {
      const eventTypes = new Set(match.events.map((event) => event.type));
      return (
        eventTypes.has(RUSKI_EVENT_TYPE_IDS.tri) ||
        eventTypes.has(RUSKI_EVENT_TYPE_IDS.splashOut)
      );
    });

    expect(events.some((event) => event.type === RUSKI_EVENT_TYPE_IDS.tri)).toBe(
      true
    );
    expect(
      events.some((event) => event.type === RUSKI_EVENT_TYPE_IDS.splashOut)
    ).toBe(true);
    expect(matchWithSpecialMiss?.boxScore.totals).toMatchObject({
      [RUSKI_STAT_KEYS.misses]: expect.any(Number)
    });
    expect(matchWithSpecialMiss?.boxScore.totals?.[RUSKI_STAT_KEYS.misses]).toBeGreaterThan(
      0
    );
  });

  it("keeps normalized snapshot output independent of Excel cell coordinates", async () => {
    const snapshot = await normalizeFixture(await parseFixture());
    const serialized = JSON.stringify(snapshot);

    expect(serialized).not.toContain("sourceCell");
    expect(serialized).not.toContain("sourceCells");
    expect(serialized).not.toContain("B10");
    expect(serialized).not.toContain("D3");
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

function normalizeFixture(parsed: ParsedScorebook) {
  return new RuskiScorebookNormalizer(undefined, {
    now: () => "2026-06-21T12:00:00.000Z",
    confirmedTeams: [
      {
        id: "team-jp-shu",
        name: "JP/Shu",
        players: ["Jaden Pearlmutter", "Ford Tate"]
      },
      {
        id: "team-ev-hulu",
        name: "Ev/Hulu",
        players: ["Henry Lewis", "Everett Schroeder"]
      }
    ]
  }).normalizeScorebook(parsed);
}
