import {
  ParsedWorkbookShotRow,
  WorkbookFormulaSummaryMetric,
  WorkbookFormulaSummaryObservation,
  WorkbookIssue
} from "./types";

export interface WorkbookFormulaScoringTotals {
  readonly makes: number;
  readonly misses: number;
  readonly attempts: number;
  readonly shootingPercentage: number | null;
  readonly splashOuts: number;
  readonly guys: number;
  readonly tris: number;
  readonly dis: number;
  readonly voms: number;
}

export interface WorkbookFormulaScoringImpact {
  readonly teams: readonly {
    readonly sideNumber: 1 | 2;
    readonly totals: WorkbookFormulaScoringTotals;
  }[];
  readonly players: readonly {
    readonly sideNumber: 1 | 2;
    readonly rosterSlot: number;
    readonly totals: WorkbookFormulaScoringTotals;
  }[];
}

const PERCENTAGE_TOLERANCE = 1e-9;

export function deriveWorkbookFormulaScoringImpact(
  rows: readonly ParsedWorkbookShotRow[],
  playersPerTeam: number
): WorkbookFormulaScoringImpact {
  if (!Number.isSafeInteger(playersPerTeam) || playersPerTeam < 1 ||
      playersPerTeam > 8) {
    throw new Error("Workbook formula scoring requires one-to-eight-player sides.");
  }
  const teams = ([1, 2] as const).map((sideNumber) => ({
    sideNumber,
    totals: scoringTotals(rows.filter((row) => row.sideNumber === sideNumber))
  }));
  const players = ([1, 2] as const).flatMap((sideNumber) =>
    Array.from({ length: playersPerTeam }, (_, index) => {
      const rosterSlot = index + 1;
      return {
        sideNumber,
        rosterSlot,
        totals: scoringTotals(rows.filter((row) =>
          row.sideNumber === sideNumber &&
          (row.worksheetRow - 10) % playersPerTeam + 1 === rosterSlot
        ))
      };
    })
  );
  return { teams, players };
}

export function compareWorkbookFormulaSummaries(
  observations: readonly WorkbookFormulaSummaryObservation[],
  impact: WorkbookFormulaScoringImpact
): WorkbookIssue[] {
  return observations.flatMap((observation) => {
    const totals = expectedTotals(observation, impact);
    if (totals === undefined) {
      return [warning(
        "SCORECARD_FORMULA_SUMMARY_MISMATCH",
        "A displayed workbook summary could not be matched to canonical scoring identity."
      )];
    }
    const issues: WorkbookIssue[] = [];
    if (observation.formulaState === "changed") {
      issues.push(warning(
        "SCORECARD_FORMULA_SUMMARY_CHANGED",
        "A generated workbook summary formula was changed; canonical scoring ignores it."
      ));
    }
    if (observation.cachedValue === null) {
      issues.push(warning(
        "SCORECARD_FORMULA_SUMMARY_MISSING",
        "A workbook summary has no cached numeric value; canonical scoring remains authoritative."
      ));
      return issues;
    }
    const expected = metricValue(totals, observation.metric);
    if (valuesAgree(observation.metric, observation.cachedValue, expected, totals)) {
      return issues;
    }
    issues.push(warning(
      observation.formulaState === "exact"
        ? "SCORECARD_FORMULA_SUMMARY_STALE"
        : "SCORECARD_FORMULA_SUMMARY_MISMATCH",
      observation.formulaState === "exact"
        ? "A generated workbook summary cache is stale; canonical scoring ignores it."
        : "A displayed workbook summary differs from canonical scoring and was ignored."
    ));
    return issues;
  });
}

function expectedTotals(
  observation: WorkbookFormulaSummaryObservation,
  impact: WorkbookFormulaScoringImpact
): WorkbookFormulaScoringTotals | undefined {
  if (observation.subjectType === "team") {
    return impact.teams.find((team) =>
      team.sideNumber === observation.sideNumber
    )?.totals;
  }
  return impact.players.find((player) =>
    player.sideNumber === observation.sideNumber &&
    player.rosterSlot === observation.rosterSlot
  )?.totals;
}

function metricValue(
  totals: WorkbookFormulaScoringTotals,
  metric: WorkbookFormulaSummaryMetric
): number | null {
  return totals[metric];
}

function valuesAgree(
  metric: WorkbookFormulaSummaryMetric,
  observed: number,
  expected: number | null,
  totals: WorkbookFormulaScoringTotals
): boolean {
  if (metric !== "shootingPercentage") {
    return expected === observed;
  }
  if (totals.attempts === 0 && (expected === null || expected === 0)) {
    return observed === 0;
  }
  return expected !== null && Math.abs(expected - observed) <= PERCENTAGE_TOLERANCE;
}

function warning(code: string, message: string): WorkbookIssue {
  return { code, severity: "warning", message };
}

function scoringTotals(
  rows: readonly ParsedWorkbookShotRow[]
): WorkbookFormulaScoringTotals {
  const makes = rows.filter((row) => row.markers.make).length;
  const misses = rows.filter((row) => row.markers.miss).length;
  const attempts = makes + misses;
  return {
    makes,
    misses,
    attempts,
    shootingPercentage: attempts === 0 ? null : makes / attempts,
    splashOuts: rows.filter((row) => row.markers.splashOut).length,
    guys: rows.filter((row) => row.markers.guy).length,
    tris: rows.filter((row) => row.markers.tri).length,
    dis: rows.filter((row) => row.markers.di).length,
    voms: rows.filter((row) => row.markers.vom).length
  };
}
