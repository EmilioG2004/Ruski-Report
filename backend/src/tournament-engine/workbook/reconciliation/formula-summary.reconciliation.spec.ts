import {
  compareWorkbookFormulaSummaries,
  deriveWorkbookFormulaScoringImpact
} from "./formula-summary.reconciliation";
import { WorkbookFormulaSummaryObservation } from "./types";

describe("workbook formula summary reconciliation", () => {
  const totals = {
    makes: 1,
    misses: 2,
    attempts: 3,
    shootingPercentage: 1 / 3,
    splashOuts: 1,
    guys: 0,
    tris: 0,
    dis: 1,
    voms: 0
  };
  const impact = {
    teams: [{ sideNumber: 1 as const, totals }],
    players: [{ sideNumber: 1 as const, rosterSlot: 1, totals }]
  };

  it("accepts exact counts and percentages within 1e-9", () => {
    expect(compareWorkbookFormulaSummaries([
      observation("makes", 1),
      observation("shootingPercentage", 1 / 3 + 0.5e-9)
    ], impact)).toEqual([]);
  });

  it("reports changed, missing, stale, and mismatched summaries as warnings", () => {
    const issues = compareWorkbookFormulaSummaries([
      observation("makes", 1, "changed"),
      observation("misses", null),
      observation("makes", 9),
      observation("dis", 9, "changed")
    ], impact);

    expect(issues.map((issue) => issue.code)).toEqual([
      "SCORECARD_FORMULA_SUMMARY_CHANGED",
      "SCORECARD_FORMULA_SUMMARY_MISSING",
      "SCORECARD_FORMULA_SUMMARY_STALE",
      "SCORECARD_FORMULA_SUMMARY_CHANGED",
      "SCORECARD_FORMULA_SUMMARY_MISMATCH"
    ]);
    expect(issues.every((issue) => issue.severity === "warning")).toBe(true);
  });

  it("treats null canonical percentage and cached zero as compatible at zero attempts", () => {
    const zero = {
      ...totals,
      makes: 0,
      misses: 0,
      attempts: 0,
      shootingPercentage: null
    };
    expect(compareWorkbookFormulaSummaries([
      observation("shootingPercentage", 0)
    ], {
      teams: [{ sideNumber: 1, totals: zero }],
      players: [{ sideNumber: 1, rosterSlot: 1, totals: zero }]
    })).toEqual([]);
  });

  it("does not expose values, cells, sheets, formulas, or participant content", () => {
    const serialized = JSON.stringify(compareWorkbookFormulaSummaries([
      observation("makes", 99, "changed")
    ], impact));

    expect(serialized).not.toMatch(/99|SUMPRODUCT|worksheet|cell|player/i);
  });

  it.each([1, 3, 8])(
    "derives generalized team and player totals for %i-player sides",
    (playersPerTeam) => {
      const rows = ([1, 2] as const).flatMap((sideNumber) =>
        Array.from({ length: 80 }, (_, index) => ({
          sideNumber,
          worksheetRow: index + 10,
          shotNumber: Math.floor(index / playersPerTeam) + 1,
          observedShooter: null,
          markers: {
            miss: index === 0,
            make: index === playersPerTeam,
            splashOut: index === 0,
            guy: false,
            tri: false,
            di: false,
            vom: index === playersPerTeam * 2
          }
        }))
      );

      const derived = deriveWorkbookFormulaScoringImpact(rows, playersPerTeam);

      expect(derived.teams).toEqual([
        { sideNumber: 1, totals: expectedTotals() },
        { sideNumber: 2, totals: expectedTotals() }
      ]);
      expect(derived.players).toHaveLength(playersPerTeam * 2);
      expect(derived.players.filter((player) => player.rosterSlot === 1))
        .toEqual([
          { sideNumber: 1, rosterSlot: 1, totals: expectedTotals() },
          { sideNumber: 2, rosterSlot: 1, totals: expectedTotals() }
        ]);
    }
  );
});

function expectedTotals() {
  return {
    makes: 1,
    misses: 1,
    attempts: 2,
    shootingPercentage: 0.5,
    splashOuts: 1,
    guys: 0,
    tris: 0,
    dis: 0,
    voms: 1
  };
}

function observation(
  metric: WorkbookFormulaSummaryObservation["metric"],
  cachedValue: number | null,
  formulaState: WorkbookFormulaSummaryObservation["formulaState"] = "exact"
): WorkbookFormulaSummaryObservation {
  return {
    sideNumber: 1,
    subjectType: "player",
    rosterSlot: 1,
    metric,
    formulaState,
    cachedValue
  };
}
