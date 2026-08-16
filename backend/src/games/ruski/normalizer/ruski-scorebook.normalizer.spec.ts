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
      normalizedFrom: "ruski-scorebook",
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

  it("normalizes the workbook into eight pods and 32 canonical teams", async () => {
    const snapshot = await normalizeCanonicalFixture(await parseFixture());

    expect(snapshot.tournament.teams).toHaveLength(32);
    expect(snapshot.tournament.pods).toHaveLength(8);
    expect(snapshot.tournament.standings).toHaveLength(32);
    expect(snapshot.tournament.pods.every((pod) => pod.teamIds.length === 4)).toBe(true);
    expect(snapshot.tournament.pods.every((pod) => pod.standingIds?.length === 4)).toBe(true);
    expect(new Set(snapshot.tournament.teams.map((team) => team.id)).size).toBe(32);
    expect(snapshot.tournament.standings[0]).toMatchObject({
      podId: "pod-pod-a",
      rank: 1,
      record: { wins: 3, losses: 0 },
      metricValues: {
        cupDifferential: 7,
        shootingPercentage: 0.2849462366
      }
    });
  });

  it("normalizes metadata-driven statistic tables with canonical identities", async () => {
    const snapshot = await normalizeCanonicalFixture(await parseFixture());
    const tables = snapshot.tournament.statistics ?? [];
    const teamIds = new Set(snapshot.tournament.teams.map((team) => team.id));

    expect(tables.map((table) => [table.id, table.rows.length])).toEqual([
      ["season-player-statistics", 65],
      ["season-team-statistics", 32],
      ["playoff-player-statistics", 32]
    ]);
    expect(
      tables
        .find((table) => table.id === "season-team-statistics")
        ?.rows.every((row) =>
          row.subject.teamId !== undefined && teamIds.has(row.subject.teamId)
        )
    ).toBe(true);
    expect(
      tables
        .find((table) => table.id === "season-player-statistics")
        ?.rows.find((row) => row.subject.label === "Dylan and Matian")
        ?.values
    ).toMatchObject({
      tris: expect.any(Number),
      dis: expect.any(Number),
      voms: expect.any(Number)
    });
  });

  it("normalizes bracket rounds, winners, and available match links", async () => {
    const snapshot = await normalizeCanonicalFixture(await parseFixture());
    const bracket = snapshot.tournament.bracket;

    expect(bracket?.rounds.map((round) => round.matches.length)).toEqual([8, 4, 2, 1]);
    expect(bracket?.rounds[0].matches[0]).toMatchObject({
      id: "sweet-16-1",
      status: "completed",
      matchId: expect.any(String),
      winnerTeamId: "team-brando-heath"
    });
    expect(bracket?.rounds[1].matches[0].slots[0].source).toEqual({
      type: "match-winner",
      sourceMatchId: "sweet-16-1"
    });
    expect(bracket?.metadata?.championTeamId).toBe("team-everett-hulu");
  });

  it("reuses canonical team IDs across standings, matches, stats, and bracket", async () => {
    const snapshot = await normalizeCanonicalFixture(await parseFixture());
    const teamIds = new Set(snapshot.tournament.teams.map((team) => team.id));
    const referencedTeamIds = [
      ...snapshot.tournament.standings.map((standing) => standing.teamId),
      ...snapshot.matches.flatMap((match) =>
        match.participants.map((participant) => participant.teamId)
      ),
      ...(snapshot.tournament.statistics ?? []).flatMap((table) =>
        table.rows.flatMap((row) => row.subject.teamId ?? [])
      ),
      ...(snapshot.tournament.bracket?.rounds ?? []).flatMap((round) =>
        round.matches.flatMap((match) => [
          ...match.slots.flatMap((slot) => slot.teamId ?? []),
          ...(match.winnerTeamId === undefined ? [] : [match.winnerTeamId])
        ])
      )
    ];

    expect(referencedTeamIds.every((teamId) => teamIds.has(teamId))).toBe(true);
    expect(snapshot.matches.filter((match) => match.podId !== undefined)).toHaveLength(44);
    expect(snapshot.matches.filter((match) => match.bracketMatchId !== undefined)).toHaveLength(12);
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

function normalizeCanonicalFixture(parsed: ParsedScorebook) {
  return new RuskiScorebookNormalizer(undefined, {
    now: () => "2026-06-21T12:00:00.000Z"
  }).normalizeScorebook(parsed);
}
