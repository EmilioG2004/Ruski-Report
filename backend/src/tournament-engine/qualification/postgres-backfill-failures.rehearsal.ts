import { QueryResultRow } from "pg";

import { PostgresDatabase } from "../../database/postgres-database";
import { PostgresTournamentReadRepository } from
  "../../repositories/postgres/postgres-tournament-read.repository";
import {
  LegacyBackfillCounts,
  LegacyBackfillPlan,
  LegacyBackfillPlanner,
  LegacyBackfillRunResult,
  PostgresLegacySnapshotReader,
  runLegacy2026Backfill
} from "../legacy";
import { createDigest } from "../legacy/legacy-determinism";

export const BACKFILL_FAILURE_SCENARIOS = [
  "backfill-apply",
  "projection-materialization",
  "active-pointer",
  "before-commit"
] as const;

export type BackfillFailureScenario =
  (typeof BACKFILL_FAILURE_SCENARIOS)[number];

export interface BackfillFailureRehearsalInput {
  database: PostgresDatabase;
  expectedDatabaseName: string;
  legacyTournamentId: string;
  scenario: BackfillFailureScenario;
}

export interface BackfillFailureRehearsalReport {
  schemaVersion: 1;
  status: "passed";
  scenario: BackfillFailureScenario;
  targetDigest: string;
  database: {
    nameDigest: string;
    serverVersion: string;
    migrationCount: number;
    latestMigration: number;
  };
  plan: {
    sourceSnapshotVersion: number;
    sourceDigest: string;
    planDigest: string;
    mappingDigest: string;
    counts: LegacyBackfillCounts;
  };
  injection: {
    expectedFaultHits: number;
    observedFaultHits: number;
    status: "failed";
    retryable: true;
    issueCodes: string[];
  };
  rollback: {
    canonicalArtifactsAbsent: true;
    completedCheckpointAbsent: true;
    legacyProjectionReadable: true;
    protectedLegacyStateUnchanged: true;
    compatibilityIdentitiesUnchanged: true;
    activeProjectionPointersUnchanged: true;
    attemptCount: number;
  };
  retry: {
    applyStatus: "applied";
    noOpStatus: "no_op";
    activeProjectionVersion: number;
    projectedMatchCount: number;
    checkpointAttemptCount: number;
    protectedLegacyDigest: string;
    correctionPolicy: "canonical_match_events_v1";
    correctionCount: number;
    correctionDigest: string;
  };
  cleanup: {
    faultObjectsRemoved: true;
  };
}

export type BackfillFailureRehearsalErrorCode =
  | "DATABASE_GUARD_FAILED"
  | "MIGRATION_GUARD_FAILED"
  | "TARGET_STATE_INVALID"
  | "QUALIFICATION_LOCK_UNAVAILABLE"
  | "DRY_RUN_FAILED"
  | "DRY_RUN_NONDETERMINISTIC"
  | "FAULT_INSTALL_FAILED"
  | "FAULT_NOT_OBSERVED"
  | "FAULT_OUTCOME_INVALID"
  | "ROLLBACK_ASSERTION_FAILED"
  | "FAULT_CLEANUP_FAILED"
  | "RETRY_APPLY_FAILED"
  | "RETRY_NO_OP_FAILED"
  | "RETRY_ASSERTION_FAILED";

export class BackfillFailureRehearsalError extends Error {
  constructor(readonly code: BackfillFailureRehearsalErrorCode) {
    super(code);
    this.name = BackfillFailureRehearsalError.name;
  }
}

interface DatabaseIdentityRow extends QueryResultRow {
  database_name: string;
  server_version: string;
  in_recovery: boolean;
  migration_versions: number[];
}

interface CheckpointRow extends QueryResultRow {
  status: "running" | "completed" | "failed" | "no_op";
  attempt_count: string;
  error_summary: string | null;
  protected_legacy_digest: string | null;
  correction_policy: string | null;
  correction_count: string | null;
  correction_digest: string | null;
}

interface ArtifactCountRow extends QueryResultRow {
  tournaments: string;
  legacy_links: string;
  projections: string;
  tournament_payloads: string;
  match_payloads: string;
  activations: string;
  active_pointers: string;
  audit_events: string;
}

interface ProjectionStateRow extends QueryResultRow {
  projection_version: string;
  status: string;
  declared_match_count: string;
  actual_match_count: string;
  activation_count: string;
}

interface FaultConfiguration {
  triggerName: string;
  functionName: string;
  sequenceName: string;
  tableName: string;
  threshold: number;
}

interface ProtectedDigestInput {
  snapshotRows: QueryResultRow[];
  identities: QueryResultRow[];
  comments: QueryResultRow[];
  reports: QueryResultRow[];
  accountsAndBlocks: QueryResultRow[];
}

const REQUIRED_MIGRATIONS = Array.from({ length: 13 }, (_, index) => index + 1);
const LEGACY_BACKFILL_TOOL_VERSION = 2;

export async function runBackfillFailureRehearsal(
  input: BackfillFailureRehearsalInput
): Promise<BackfillFailureRehearsalReport> {
  const identity = await requireDisposableRuntime(input);
  const plan = await readPlan(input.database, input.legacyTournamentId);
  if (
    plan.counts.matchRevisions < 1 ||
    (input.scenario === "projection-materialization" &&
      plan.counts.matchProjectionPayloads < 2)
  ) {
    fail("TARGET_STATE_INVALID");
  }
  const targetDigest = createDigest(input.legacyTournamentId);
  const initialCheckpoint = await readCheckpoint(input.database, plan);
  if (initialCheckpoint?.status === "completed") {
    fail("TARGET_STATE_INVALID");
  }
  await assertTargetHasNoCanonicalState(input.database, plan);

  const lockClient = await input.database.connect();
  let qualificationLocked = false;
  try {
    const lock = await lockClient.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock(
         hashtextextended('phase7:backfill-failure:' || $1, 0)
       ) AS acquired`,
      [input.legacyTournamentId]
    );
    qualificationLocked = lock.rows[0]?.acquired === true;
    if (!qualificationLocked) {
      fail("QUALIFICATION_LOCK_UNAVAILABLE");
    }

    return await runLockedRehearsal(
      input,
      identity,
      plan,
      targetDigest,
      Number(initialCheckpoint?.attempt_count ?? 0)
    );
  } finally {
    if (qualificationLocked) {
      await lockClient.query(
        `SELECT pg_advisory_unlock(
           hashtextextended('phase7:backfill-failure:' || $1, 0)
         )`,
        [input.legacyTournamentId]
      );
    }
    lockClient.release();
  }
}

async function runLockedRehearsal(
  input: BackfillFailureRehearsalInput,
  identity: DatabaseIdentityRow,
  plan: LegacyBackfillPlan,
  targetDigest: string,
  initialAttemptCount: number
): Promise<BackfillFailureRehearsalReport> {
  const firstDryRun = await runLegacy2026Backfill({
    database: input.database,
    legacyTournamentId: input.legacyTournamentId,
    dryRun: true
  });
  requireOutcome(firstDryRun, "dry_run", false, "DRY_RUN_FAILED");
  assertPlanMatches(plan, firstDryRun, "DRY_RUN_NONDETERMINISTIC");

  const secondDryRun = await runLegacy2026Backfill({
    database: input.database,
    legacyTournamentId: input.legacyTournamentId,
    dryRun: true
  });
  requireOutcome(secondDryRun, "dry_run", false, "DRY_RUN_FAILED");
  assertPlanMatches(plan, secondDryRun, "DRY_RUN_NONDETERMINISTIC");

  const baseline = await readRollbackBaseline(input.database, plan);
  const fault = faultConfiguration(input.scenario);
  let faultObjectsRemoved = false;
  let observedFaultHits = 0;
  let failedResult: LegacyBackfillRunResult | undefined;

  try {
    await installFault(input.database, fault, plan);
    failedResult = await runLegacy2026Backfill({
      database: input.database,
      legacyTournamentId: input.legacyTournamentId
    });
    observedFaultHits = await readFaultHits(input.database, fault);
    if (observedFaultHits !== fault.threshold) {
      fail("FAULT_NOT_OBSERVED");
    }
    requireInjectedFailure(failedResult);
    assertPlanMatches(plan, failedResult, "FAULT_OUTCOME_INVALID");
    await assertRolledBack(
      input.database,
      plan,
      baseline,
      initialAttemptCount + 3
    );
  } finally {
    try {
      await removeFault(input.database, fault);
      await assertFaultRemoved(input.database, fault);
      faultObjectsRemoved = true;
    } catch {
      fail("FAULT_CLEANUP_FAILED");
    }
  }

  if (failedResult === undefined || !faultObjectsRemoved) {
    fail("FAULT_OUTCOME_INVALID");
  }

  const applied = await runLegacy2026Backfill({
    database: input.database,
    legacyTournamentId: input.legacyTournamentId
  });
  requireOutcome(applied, "applied", false, "RETRY_APPLY_FAILED");
  assertPlanMatches(plan, applied, "RETRY_APPLY_FAILED");
  await assertSuccessfulRetry(
    input.database,
    plan,
    baseline,
    initialAttemptCount + 4
  );

  const noOp = await runLegacy2026Backfill({
    database: input.database,
    legacyTournamentId: input.legacyTournamentId
  });
  requireOutcome(noOp, "no_op", false, "RETRY_NO_OP_FAILED");
  assertPlanMatches(plan, noOp, "RETRY_NO_OP_FAILED");
  const checkpoint = await requireCompletedCheckpoint(
    input.database,
    plan,
    initialAttemptCount + 5
  );
  const projection = await requireCoherentProjection(input.database, plan);
  const finalLegacyDigest = await readLegacyPublicDigest(
    input.database,
    input.legacyTournamentId
  );
  const finalProtectedDigest = await readProtectedLegacyDigest(input.database, plan);
  if (
    finalLegacyDigest !== baseline.legacyPublicDigest ||
    finalProtectedDigest !== baseline.protectedLegacyDigest ||
    checkpoint.protected_legacy_digest !== baseline.protectedLegacyDigest
  ) {
    fail("RETRY_ASSERTION_FAILED");
  }

  return {
    schemaVersion: 1,
    status: "passed",
    scenario: input.scenario,
    targetDigest,
    database: {
      nameDigest: createDigest(identity.database_name),
      serverVersion: identity.server_version,
      migrationCount: identity.migration_versions.length,
      latestMigration: Math.max(...identity.migration_versions)
    },
    plan: planEvidence(plan),
    injection: {
      expectedFaultHits: fault.threshold,
      observedFaultHits,
      status: "failed",
      retryable: true,
      issueCodes: failedResult.issues.map((issue) => issue.code)
    },
    rollback: {
      canonicalArtifactsAbsent: true,
      completedCheckpointAbsent: true,
      legacyProjectionReadable: true,
      protectedLegacyStateUnchanged: true,
      compatibilityIdentitiesUnchanged: true,
      activeProjectionPointersUnchanged: true,
      attemptCount: initialAttemptCount + 3
    },
    retry: {
      applyStatus: "applied",
      noOpStatus: "no_op",
      activeProjectionVersion: Number(projection.projection_version),
      projectedMatchCount: Number(projection.actual_match_count),
      checkpointAttemptCount: Number(checkpoint.attempt_count),
      protectedLegacyDigest: checkpoint.protected_legacy_digest as string,
      correctionPolicy: "canonical_match_events_v1",
      correctionCount: Number(checkpoint.correction_count),
      correctionDigest: checkpoint.correction_digest as string
    },
    cleanup: { faultObjectsRemoved: true }
  };
}

async function requireDisposableRuntime(
  input: BackfillFailureRehearsalInput
): Promise<DatabaseIdentityRow> {
  let result;
  try {
    result = await input.database.query<DatabaseIdentityRow>(`
      SELECT current_database() AS database_name,
             current_setting('server_version') AS server_version,
             pg_is_in_recovery() AS in_recovery,
             COALESCE(
               (SELECT array_agg(version ORDER BY version)
                FROM schema_migrations),
               ARRAY[]::integer[]
             ) AS migration_versions
    `);
  } catch {
    fail("DATABASE_GUARD_FAILED");
  }
  const row = result.rows[0];
  if (
    row === undefined ||
    row.database_name !== input.expectedDatabaseName ||
    row.in_recovery ||
    !isDisposableDatabaseName(row.database_name)
  ) {
    fail("DATABASE_GUARD_FAILED");
  }
  if (!REQUIRED_MIGRATIONS.every((version) =>
    row.migration_versions.includes(version))) {
    fail("MIGRATION_GUARD_FAILED");
  }
  for (const table of [
    "engine_legacy_backfill_runs",
    "engine_match_revisions",
    "engine_public_match_projection_payloads",
    "engine_active_projection_versions"
  ]) {
    const tableResult = await input.database.query<{ present: boolean }>(
      "SELECT to_regclass($1) IS NOT NULL AS present",
      [`public.${table}`]
    );
    if (tableResult.rows[0]?.present !== true) {
      fail("MIGRATION_GUARD_FAILED");
    }
  }
  return row;
}

async function readPlan(
  database: PostgresDatabase,
  legacyTournamentId: string
): Promise<LegacyBackfillPlan> {
  try {
    const source = await new PostgresLegacySnapshotReader(database)
      .readActiveSnapshot(legacyTournamentId);
    if (source === null) {
      fail("TARGET_STATE_INVALID");
    }
    return new LegacyBackfillPlanner().plan(source);
  } catch (error) {
    if (error instanceof BackfillFailureRehearsalError) {
      throw error;
    }
    fail("TARGET_STATE_INVALID");
  }
}

function planEvidence(plan: LegacyBackfillPlan) {
  return {
    sourceSnapshotVersion: plan.sourceSnapshotVersion,
    sourceDigest: plan.sourceDigest,
    planDigest: plan.planDigest,
    mappingDigest: plan.mappingDigest,
    counts: plan.counts
  };
}

function assertPlanMatches(
  plan: LegacyBackfillPlan,
  result: LegacyBackfillRunResult,
  code: BackfillFailureRehearsalErrorCode
): void {
  if (
    result.legacyTournamentId !== plan.legacyTournamentId ||
    result.sourceSnapshotVersion !== plan.sourceSnapshotVersion ||
    result.sourceDigest !== plan.sourceDigest ||
    result.planDigest !== plan.planDigest ||
    result.mappingDigest !== plan.mappingDigest ||
    createDigest(result.counts) !== createDigest(plan.counts)
  ) {
    fail(code);
  }
}

function requireOutcome(
  result: LegacyBackfillRunResult,
  expectedStatus: "dry_run" | "applied" | "no_op",
  expectedRetryable: boolean,
  code: BackfillFailureRehearsalErrorCode
): void {
  if (
    result.status !== expectedStatus ||
    result.retryable !== expectedRetryable ||
    result.issues.length !== 0
  ) {
    fail(code);
  }
}

function requireInjectedFailure(result: LegacyBackfillRunResult): void {
  const issueCodes = result.issues.map((issue) => issue.code);
  if (
    result.status !== "failed" ||
    !result.retryable ||
    createDigest(issueCodes) !== createDigest(["LEGACY_BACKFILL_APPLY_FAILED"])
  ) {
    fail("FAULT_OUTCOME_INVALID");
  }
}

function faultConfiguration(
  scenario: BackfillFailureScenario
): FaultConfiguration {
  const suffix = scenario.replaceAll("-", "_");
  const tables: Record<BackfillFailureScenario, string> = {
    "backfill-apply": "engine_match_revisions",
    "projection-materialization": "engine_public_match_projection_payloads",
    "active-pointer": "engine_active_projection_versions",
    "before-commit": "engine_legacy_backfill_runs"
  };
  return {
    triggerName: `zz_phase7_qualification_${suffix}`,
    functionName: `phase7_qualification_${suffix}_fn`,
    sequenceName: `phase7_qualification_${suffix}_hits`,
    tableName: tables[scenario],
    threshold: scenario === "projection-materialization" ? 2 : 1
  };
}

async function installFault(
  database: PostgresDatabase,
  fault: FaultConfiguration,
  plan: LegacyBackfillPlan
): Promise<void> {
  await removeFault(database, fault);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SEQUENCE public.${fault.sequenceName}`);
    const scope = fault.tableName === "engine_legacy_backfill_runs"
      ? `IF NEW.status <> 'completed' OR NEW.source_digest <> TG_ARGV[0] THEN
           RETURN NEW;
         END IF;`
      : `IF NEW.tournament_id <> TG_ARGV[0]::uuid THEN
           RETURN NEW;
         END IF;`;
    await client.query(`
      CREATE FUNCTION public.${fault.functionName}()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $fault$
      DECLARE
        qualification_hit bigint;
      BEGIN
        ${scope}
        qualification_hit := nextval('public.${fault.sequenceName}');
        IF qualification_hit = ${fault.threshold} THEN
          RAISE EXCEPTION 'phase7 qualification fault'
            USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END;
      $fault$
    `);
    const argument = fault.tableName === "engine_legacy_backfill_runs"
      ? plan.sourceDigest
      : plan.tournament.id;
    const event = fault.tableName === "engine_active_projection_versions"
      ? "BEFORE INSERT OR UPDATE"
      : fault.tableName === "engine_legacy_backfill_runs"
        ? "AFTER UPDATE OF status"
        : "BEFORE INSERT";
    const constraint = fault.tableName === "engine_legacy_backfill_runs"
      ? "CONSTRAINT "
      : "";
    const deferred = fault.tableName === "engine_legacy_backfill_runs"
      ? "DEFERRABLE INITIALLY DEFERRED "
      : "";
    await client.query(`
      CREATE ${constraint}TRIGGER ${fault.triggerName}
      ${event} ON public.${fault.tableName}
      ${deferred}FOR EACH ROW
      EXECUTE FUNCTION public.${fault.functionName}('${sqlLiteral(argument)}')
    `);
    await client.query("COMMIT");
  } catch {
    await rollbackQuietly(client);
    fail("FAULT_INSTALL_FAILED");
  } finally {
    client.release();
  }
  const installed = await database.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM pg_trigger
     WHERE tgname = $1 AND NOT tgisinternal`,
    [fault.triggerName]
  );
  if (installed.rows[0]?.count !== "1") {
    fail("FAULT_INSTALL_FAILED");
  }
}

async function removeFault(
  database: PostgresDatabase,
  fault: FaultConfiguration
): Promise<void> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DROP TRIGGER IF EXISTS ${fault.triggerName}
       ON public.${fault.tableName}`
    );
    await client.query(`DROP FUNCTION IF EXISTS public.${fault.functionName}()`);
    await client.query(`DROP SEQUENCE IF EXISTS public.${fault.sequenceName}`);
    await client.query("COMMIT");
  } catch {
    await rollbackQuietly(client);
    throw new BackfillFailureRehearsalError("FAULT_CLEANUP_FAILED");
  } finally {
    client.release();
  }
}

async function readFaultHits(
  database: PostgresDatabase,
  fault: FaultConfiguration
): Promise<number> {
  const result = await database.query<{ hits: string }>(
    `SELECT CASE WHEN is_called THEN last_value ELSE 0 END::text AS hits
     FROM public.${fault.sequenceName}`
  );
  return Number(result.rows[0]?.hits ?? -1);
}

async function assertFaultRemoved(
  database: PostgresDatabase,
  fault: FaultConfiguration
): Promise<void> {
  const result = await database.query<{
    trigger_count: string;
    function_present: boolean;
    sequence_present: boolean;
  }>(
    `SELECT
       (SELECT count(*)::text FROM pg_trigger
        WHERE tgname = $1 AND NOT tgisinternal) AS trigger_count,
       to_regprocedure($2) IS NOT NULL AS function_present,
       to_regclass($3) IS NOT NULL AS sequence_present`,
    [
      fault.triggerName,
      `public.${fault.functionName}()`,
      `public.${fault.sequenceName}`
    ]
  );
  const row = result.rows[0];
  if (
    row?.trigger_count !== "0" ||
    row.function_present ||
    row.sequence_present
  ) {
    fail("FAULT_CLEANUP_FAILED");
  }
}

async function readRollbackBaseline(
  database: PostgresDatabase,
  plan: LegacyBackfillPlan
) {
  return {
    protectedLegacyDigest: await readProtectedLegacyDigest(database, plan),
    legacyPublicDigest: await readLegacyPublicDigest(
      database,
      plan.legacyTournamentId
    ),
    matchIdentityDigest: await readMatchIdentityDigest(
      database,
      plan.legacyTournamentId
    ),
    activePointerDigest: await readActivePointerDigest(database)
  };
}

async function assertRolledBack(
  database: PostgresDatabase,
  plan: LegacyBackfillPlan,
  baseline: Awaited<ReturnType<typeof readRollbackBaseline>>,
  expectedAttemptCount: number
): Promise<void> {
  await assertTargetHasNoCanonicalState(database, plan);
  const checkpoint = await readCheckpoint(database, plan);
  if (
    checkpoint?.status !== "failed" ||
    Number(checkpoint.attempt_count) !== expectedAttemptCount ||
    checkpoint.error_summary !== "LEGACY_BACKFILL_APPLY_FAILED"
  ) {
    fail("ROLLBACK_ASSERTION_FAILED");
  }
  const actual = await readRollbackBaseline(database, plan);
  if (
    actual.protectedLegacyDigest !== baseline.protectedLegacyDigest ||
    actual.legacyPublicDigest !== baseline.legacyPublicDigest ||
    actual.matchIdentityDigest !== baseline.matchIdentityDigest ||
    actual.activePointerDigest !== baseline.activePointerDigest
  ) {
    fail("ROLLBACK_ASSERTION_FAILED");
  }
}

async function assertSuccessfulRetry(
  database: PostgresDatabase,
  plan: LegacyBackfillPlan,
  baseline: Awaited<ReturnType<typeof readRollbackBaseline>>,
  expectedAttemptCount: number
): Promise<void> {
  await requireCompletedCheckpoint(database, plan, expectedAttemptCount);
  await requireCoherentProjection(database, plan);
  if (
    await readProtectedLegacyDigest(database, plan) !==
      baseline.protectedLegacyDigest ||
    await readLegacyPublicDigest(database, plan.legacyTournamentId) !==
      baseline.legacyPublicDigest
  ) {
    fail("RETRY_ASSERTION_FAILED");
  }
}

async function assertTargetHasNoCanonicalState(
  database: PostgresDatabase,
  plan: LegacyBackfillPlan
): Promise<void> {
  const result = await database.query<ArtifactCountRow>(
    `SELECT
       (SELECT count(*) FROM engine_tournaments
        WHERE id = $1::uuid OR public_key = $2)::text AS tournaments,
       (SELECT count(*) FROM engine_legacy_tournament_links
        WHERE legacy_tournament_id = $2)::text AS legacy_links,
       (SELECT count(*) FROM engine_projection_versions
        WHERE tournament_id = $1::uuid)::text AS projections,
       (SELECT count(*) FROM engine_public_tournament_projection_payloads
        WHERE tournament_id = $1::uuid)::text AS tournament_payloads,
       (SELECT count(*) FROM engine_public_match_projection_payloads
        WHERE tournament_id = $1::uuid)::text AS match_payloads,
       (SELECT count(*) FROM engine_public_projection_activations
        WHERE tournament_id = $1::uuid)::text AS activations,
       (SELECT count(*) FROM engine_active_projection_versions
        WHERE tournament_id = $1::uuid)::text AS active_pointers,
       (SELECT count(*) FROM engine_audit_events
        WHERE tournament_id = $1::uuid)::text AS audit_events`,
    [plan.tournament.id, plan.legacyTournamentId]
  );
  const row = result.rows[0];
  if (
    row === undefined ||
    Object.values(row).some((count) => count !== "0")
  ) {
    fail("TARGET_STATE_INVALID");
  }
}

async function readCheckpoint(
  database: PostgresDatabase,
  plan: LegacyBackfillPlan
): Promise<CheckpointRow | undefined> {
  const result = await database.query<CheckpointRow>(
    `SELECT status,
            jsonb_array_length(COALESCE(metadata -> 'attempts', '[]'::jsonb))::text
              AS attempt_count,
            error_summary,
            metadata ->> 'protectedLegacyDigest' AS protected_legacy_digest,
            metadata #>> '{tournamentStatisticCorrections,policy}'
              AS correction_policy,
            metadata #>> '{tournamentStatisticCorrections,mismatchCount}'
              AS correction_count,
            metadata #>> '{tournamentStatisticCorrections,mismatchDigest}'
              AS correction_digest
     FROM engine_legacy_backfill_runs
     WHERE legacy_tournament_id = $1
       AND source_snapshot_version = $2
       AND tool_version = $3
       AND source_digest = $4`,
    [
      plan.legacyTournamentId,
      plan.sourceSnapshotVersion,
      LEGACY_BACKFILL_TOOL_VERSION,
      plan.sourceDigest
    ]
  );
  if (result.rows.length > 1) {
    fail("TARGET_STATE_INVALID");
  }
  return result.rows[0];
}

async function requireCompletedCheckpoint(
  database: PostgresDatabase,
  plan: LegacyBackfillPlan,
  expectedAttemptCount: number
): Promise<CheckpointRow> {
  const checkpoint = await readCheckpoint(database, plan);
  if (
    checkpoint?.status !== "completed" ||
    Number(checkpoint.attempt_count) !== expectedAttemptCount ||
    checkpoint.error_summary !== null ||
    !isDigest(checkpoint.protected_legacy_digest) ||
    checkpoint.correction_policy !== "canonical_match_events_v1" ||
    !isNonnegativeInteger(checkpoint.correction_count) ||
    !isDigest(checkpoint.correction_digest)
  ) {
    fail("RETRY_ASSERTION_FAILED");
  }
  return checkpoint;
}

async function requireCoherentProjection(
  database: PostgresDatabase,
  plan: LegacyBackfillPlan
): Promise<ProjectionStateRow> {
  const result = await database.query<ProjectionStateRow>(
    `SELECT active.projection_version::text,
            projection.status,
            payload.match_count::text AS declared_match_count,
            count(DISTINCT match_payload.match_id)::text AS actual_match_count,
            count(DISTINCT activation.audit_event_id)::text AS activation_count
     FROM engine_active_projection_versions active
     JOIN engine_projection_versions projection
       ON projection.tournament_id = active.tournament_id
      AND projection.version = active.projection_version
     JOIN engine_public_tournament_projection_payloads payload
       ON payload.tournament_id = active.tournament_id
      AND payload.projection_version = active.projection_version
     LEFT JOIN engine_public_match_projection_payloads match_payload
       ON match_payload.tournament_id = active.tournament_id
      AND match_payload.projection_version = active.projection_version
     LEFT JOIN engine_public_projection_activations activation
       ON activation.tournament_id = active.tournament_id
      AND activation.projection_version = active.projection_version
     WHERE active.tournament_id = $1::uuid
     GROUP BY active.projection_version, projection.status, payload.match_count`,
    [plan.tournament.id]
  );
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    row === undefined ||
    row.status !== "active" ||
    Number(row.projection_version) !== 1 ||
    Number(row.declared_match_count) !== plan.counts.matchProjectionPayloads ||
    Number(row.actual_match_count) !== plan.counts.matchProjectionPayloads ||
    Number(row.activation_count) !== 1
  ) {
    fail("RETRY_ASSERTION_FAILED");
  }
  return row;
}

async function readLegacyPublicDigest(
  database: PostgresDatabase,
  legacyTournamentId: string
): Promise<string> {
  const result = await new PostgresTournamentReadRepository(database)
    .findTournamentById(legacyTournamentId);
  if (!result.ok || result.value === null) {
    fail("ROLLBACK_ASSERTION_FAILED");
  }
  return createDigest(result.value);
}

async function readMatchIdentityDigest(
  database: PostgresDatabase,
  legacyTournamentId: string
): Promise<string> {
  const result = await database.query(
    `SELECT match_id, tournament_id, created_at::text, xmin::text AS row_version
     FROM match_identities
     WHERE tournament_id = $1
     ORDER BY match_id`,
    [legacyTournamentId]
  );
  return createDigest(result.rows);
}

async function readActivePointerDigest(database: PostgresDatabase): Promise<string> {
  const result = await database.query(
    `SELECT tournament_id::text, projection_version::text, activated_at::text
     FROM engine_active_projection_versions
     ORDER BY tournament_id`
  );
  return createDigest(result.rows);
}

async function readProtectedLegacyDigest(
  database: PostgresDatabase,
  plan: LegacyBackfillPlan
): Promise<string> {
  const matchIds = plan.identityReferences.map((reference) =>
    reference.legacyMatchId
  );
  const [identities, comments, reports, snapshotRows, accountsAndBlocks] =
    await Promise.all([
      database.query(
        `SELECT match_id, tournament_id, xmin::text AS row_version
         FROM match_identities WHERE match_id = ANY($1::text[])
         ORDER BY match_id`,
        [matchIds]
      ),
      database.query(
        `SELECT id, match_id, deleted_at::text, xmin::text AS row_version
         FROM comments WHERE match_id = ANY($1::text[]) ORDER BY id`,
        [matchIds]
      ),
      database.query(
        `SELECT id, comment_id, reported_comment_id, match_id, status,
                reviewed_at::text, resolved_at::text, resolution, moderator_id,
                xmin::text AS row_version
         FROM comment_reports WHERE match_id = ANY($1::text[]) ORDER BY id`,
        [matchIds]
      ),
      database.query(
        `SELECT 'tournaments' AS table_name, id AS row_key,
                xmin::text AS row_version
         FROM tournaments WHERE id = $1
         UNION ALL SELECT 'active_tournament_snapshots', tournament_id, xmin::text
         FROM active_tournament_snapshots WHERE tournament_id = $1
         UNION ALL SELECT 'tournament_snapshot_versions',
                tournament_id || ':' || version::text, xmin::text
         FROM tournament_snapshot_versions WHERE tournament_id = $1
         UNION ALL SELECT 'teams', snapshot_version::text || ':' || team_id,
                xmin::text FROM teams WHERE tournament_id = $1
         UNION ALL SELECT 'players', snapshot_version::text || ':' || player_id,
                xmin::text FROM players WHERE tournament_id = $1
         UNION ALL SELECT 'team_players', snapshot_version::text || ':' ||
                team_id || ':' || player_id, xmin::text
         FROM team_players WHERE tournament_id = $1
         UNION ALL SELECT 'pods', snapshot_version::text || ':' || pod_id,
                xmin::text FROM pods WHERE tournament_id = $1
         UNION ALL SELECT 'pod_teams', snapshot_version::text || ':' ||
                pod_id || ':' || team_id, xmin::text
         FROM pod_teams WHERE tournament_id = $1
         UNION ALL SELECT 'pod_matches', snapshot_version::text || ':' ||
                pod_id || ':' || match_id, xmin::text
         FROM pod_matches WHERE tournament_id = $1
         UNION ALL SELECT 'matches', snapshot_version::text || ':' || match_id,
                xmin::text FROM matches WHERE tournament_id = $1
         UNION ALL SELECT 'standings', snapshot_version::text || ':' || standing_id,
                xmin::text FROM standings WHERE tournament_id = $1
         UNION ALL SELECT 'scorebook_sources', source.id, source.xmin::text
         FROM scorebook_sources source
         WHERE source.id IN (
           SELECT snapshot.source_id FROM tournament_snapshot_versions snapshot
           WHERE snapshot.tournament_id = $1
         )
         UNION ALL SELECT 'upload_reports', report.id, report.xmin::text
         FROM upload_reports report
         WHERE report.tournament_id = $1 OR report.source_id IN (
           SELECT snapshot.source_id FROM tournament_snapshot_versions snapshot
           WHERE snapshot.tournament_id = $1
         )
         ORDER BY table_name, row_key`,
        [plan.legacyTournamentId]
      ),
      database.query(
        `WITH relevant_accounts AS (
           SELECT author_user_id AS user_id
           FROM comments WHERE match_id = ANY($1::text[])
           UNION
           SELECT reporter_user_id FROM comment_reports
           WHERE match_id = ANY($1::text[])
         )
         SELECT 'user_accounts' AS table_name, account.id AS row_key,
                account.xmin::text AS row_version
         FROM user_accounts account
         WHERE account.id IN (SELECT user_id FROM relevant_accounts)
         UNION ALL SELECT 'local_account_credentials', credential.user_id,
                credential.xmin::text
         FROM local_account_credentials credential
         WHERE credential.user_id IN (SELECT user_id FROM relevant_accounts)
         UNION ALL SELECT 'external_identities',
                identity.provider || ':' || identity.provider_subject,
                identity.xmin::text
         FROM external_identities identity
         WHERE identity.user_id IN (SELECT user_id FROM relevant_accounts)
         UNION ALL SELECT 'auth_sessions', session.id, session.xmin::text
         FROM auth_sessions session
         WHERE session.user_id IN (SELECT user_id FROM relevant_accounts)
         UNION ALL SELECT 'user_blocks',
                block.blocker_user_id || ':' || block.blocked_user_id,
                block.xmin::text
         FROM user_blocks block
         WHERE block.blocker_user_id IN (SELECT user_id FROM relevant_accounts)
            OR block.blocked_user_id IN (SELECT user_id FROM relevant_accounts)
         ORDER BY table_name, row_key`,
        [matchIds]
      )
    ]);
  const protectedRows: ProtectedDigestInput = {
    snapshotRows: snapshotRows.rows,
    identities: identities.rows,
    comments: comments.rows,
    reports: reports.rows,
    accountsAndBlocks: accountsAndBlocks.rows
  };
  return createDigest(protectedRows);
}

function isDisposableDatabaseName(databaseName: string): boolean {
  return /^phase7-[a-z0-9]+-[a-z0-9-]{6,64}$/u.test(databaseName) &&
    !["postgres", "template0", "template1", "ruski_report"].includes(
      databaseName.toLowerCase()
    );
}

function isDigest(value: string | null): value is string {
  return value !== null && /^[a-f0-9]{64}$/u.test(value);
}

function isNonnegativeInteger(value: string | null): boolean {
  if (value === null) {
    return false;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0;
}

function sqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

async function rollbackQuietly(client: {
  query(text: string): Promise<unknown>;
}): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original sanitized rehearsal failure.
  }
}

function fail(code: BackfillFailureRehearsalErrorCode): never {
  throw new BackfillFailureRehearsalError(code);
}
