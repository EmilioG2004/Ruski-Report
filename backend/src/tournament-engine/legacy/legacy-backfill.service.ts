import { randomUUID } from "node:crypto";

import {
  LegacyBackfillRepository,
  LegacySnapshotReader
} from "./legacy-backfill.repository";
import {
  LegacyBackfillCounts,
  LegacyBackfillIssue,
  LegacyBackfillPlan,
  LegacyBackfillRecordedState,
  LegacyBackfillRunRecord,
  LegacyBackfillRunResult
} from "./legacy-backfill.types";
import {
  LegacyBackfillPlanner,
  LegacyBackfillPlanningError
} from "./legacy-backfill-planner";

export interface RunLegacyBackfillInput {
  legacyTournamentId: string;
  dryRun?: boolean;
}

export interface LegacyBackfillClock {
  now(): string;
}

const systemClock: LegacyBackfillClock = {
  now: () => new Date().toISOString()
};

export class LegacyBackfillService {
  constructor(
    private readonly reader: LegacySnapshotReader,
    private readonly repository: LegacyBackfillRepository,
    private readonly planner = new LegacyBackfillPlanner(),
    private readonly clock: LegacyBackfillClock = systemClock,
    private readonly runIdFactory: () => string = randomUUID
  ) {}

  async run(input: RunLegacyBackfillInput): Promise<LegacyBackfillRunResult> {
    const runId = this.runIdFactory();
    const startedAt = this.clock.now();
    const dryRun = input.dryRun ?? false;

    let plan: LegacyBackfillPlan;
    try {
      const source = await this.reader.readActiveSnapshot(input.legacyTournamentId);
      if (source === null) {
        return this.recordResult({
          runId,
          legacyTournamentId: input.legacyTournamentId,
          dryRun,
          status: "failed",
          startedAt,
          completedAt: this.clock.now(),
          issues: [
            {
              code: "LEGACY_TOURNAMENT_NOT_FOUND",
              message: "The requested active legacy tournament snapshot was not found."
            }
          ],
          retryable: false
        });
      }
      plan = this.planner.plan(source);
    } catch (error) {
      const planningIssues = error instanceof LegacyBackfillPlanningError
        ? error.issues
        : [
            {
              code: "LEGACY_SOURCE_READ_FAILED",
              message: "The legacy source could not be read for backfill planning."
            }
          ];
      return this.recordResult({
        runId,
        legacyTournamentId: input.legacyTournamentId,
        dryRun,
        status: "failed",
        startedAt,
        completedAt: this.clock.now(),
        issues: planningIssues,
        retryable: !(error instanceof LegacyBackfillPlanningError)
      });
    }

    let existing: LegacyBackfillRecordedState | null;
    try {
      existing = await this.repository.findRecordedState(
        input.legacyTournamentId
      );
    } catch {
      return this.recordResult(
        resultFromPlan(plan, {
          runId,
          dryRun,
          startedAt,
          completedAt: this.clock.now(),
          status: "failed",
          issues: [
            {
              code: "LEGACY_BACKFILL_STATE_READ_FAILED",
              message: "Canonical backfill state could not be read."
            }
          ],
          retryable: true
        })
      );
    }

    if (existing !== null) {
      const issues = comparePlanToState(plan, existing);
      return this.recordResult(
        resultFromPlan(plan, {
          runId,
          dryRun,
          startedAt,
          completedAt: this.clock.now(),
          status: issues.length === 0 ? "no_op" : "mismatch",
          issues,
          retryable: false
        })
      );
    }

    if (dryRun) {
      return this.recordResult(
        resultFromPlan(plan, {
          runId,
          dryRun,
          startedAt,
          completedAt: this.clock.now(),
          status: "dry_run",
          issues: [],
          retryable: false
        })
      );
    }

    const appliedRun = resultFromPlan(plan, {
      runId,
      dryRun,
      startedAt,
      completedAt: this.clock.now(),
      status: "applied",
      issues: [],
      retryable: false
    });
    try {
      const state = await this.repository.apply(plan, appliedRun);
      const issues = comparePlanToState(plan, state);
      if (issues.length > 0) {
        return this.recordResult({
          ...appliedRun,
          status: "failed",
          completedAt: this.clock.now(),
          issues: [
            {
              code: "LEGACY_BACKFILL_VERIFICATION_FAILED",
              message:
                "Canonical state did not match the planned counts and digests."
            },
            ...issues
          ],
          retryable: false
        });
      }
      return state.wasApplied === false
        ? this.recordResult({
            ...appliedRun,
            status: "no_op",
            completedAt: this.clock.now()
          })
        : appliedRun;
    } catch {
      return this.recordResult({
        ...appliedRun,
        status: "failed",
        completedAt: this.clock.now(),
        issues: [
          {
            code: "LEGACY_BACKFILL_APPLY_FAILED",
            message:
              "Canonical backfill application failed and must be retried after review."
          }
        ],
        retryable: true
      });
    }
  }

  private async recordResult(
    result: LegacyBackfillRunResult
  ): Promise<LegacyBackfillRunResult> {
    const { retryable: _retryable, ...run } = result;
    try {
      await this.repository.recordRun(run);
      return result;
    } catch {
      return {
        ...result,
        status: "failed",
        retryable: true,
        issues: [
          ...result.issues,
          {
            code: "LEGACY_BACKFILL_RUN_RECORD_FAILED",
            message: "The backfill run outcome could not be recorded."
          }
        ]
      };
    }
  }
}

function resultFromPlan(
  plan: LegacyBackfillPlan,
  result: Omit<
    LegacyBackfillRunResult,
    | "legacyTournamentId"
    | "sourceSnapshotVersion"
    | "sourceDigest"
    | "planDigest"
    | "mappingDigest"
    | "counts"
  >
): LegacyBackfillRunResult {
  return {
    ...result,
    legacyTournamentId: plan.legacyTournamentId,
    sourceSnapshotVersion: plan.sourceSnapshotVersion,
    sourceDigest: plan.sourceDigest,
    planDigest: plan.planDigest,
    mappingDigest: plan.mappingDigest,
    counts: plan.counts
  };
}

export function comparePlanToState(
  plan: LegacyBackfillPlan,
  state: LegacyBackfillRecordedState
): LegacyBackfillIssue[] {
  const issues: LegacyBackfillIssue[] = [];
  compareValue(
    issues,
    "LEGACY_SOURCE_SNAPSHOT_VERSION_MISMATCH",
    "Legacy source snapshot version differs from recorded canonical state.",
    plan.sourceSnapshotVersion,
    state.sourceSnapshotVersion
  );
  compareValue(
    issues,
    "LEGACY_SOURCE_DIGEST_MISMATCH",
    "Legacy source digest differs from recorded canonical state.",
    plan.sourceDigest,
    state.sourceDigest
  );
  compareValue(
    issues,
    "LEGACY_PLAN_DIGEST_MISMATCH",
    "Canonical plan digest differs from recorded canonical state.",
    plan.planDigest,
    state.planDigest
  );
  compareValue(
    issues,
    "LEGACY_MAPPING_DIGEST_MISMATCH",
    "Canonical identity mapping digest differs from recorded canonical state.",
    plan.mappingDigest,
    state.mappingDigest
  );

  for (const key of Object.keys(plan.counts) as Array<keyof LegacyBackfillCounts>) {
    compareValue(
      issues,
      `LEGACY_COUNT_${key.toUpperCase()}_MISMATCH`,
      `Canonical ${key} count differs from the planned legacy count.`,
      plan.counts[key],
      state.counts[key]
    );
  }
  return issues;
}

function compareValue(
  issues: LegacyBackfillIssue[],
  code: string,
  message: string,
  expected: string | number,
  actual: string | number
): void {
  if (expected !== actual) {
    issues.push({ code, message, expected, actual });
  }
}
