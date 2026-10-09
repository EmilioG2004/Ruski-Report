import { PostgresDatabase } from "../../database/postgres-database";
import { LegacyBackfillService } from "./legacy-backfill.service";
import { LegacyBackfillRunResult } from "./legacy-backfill.types";
import { PostgresLegacyBackfillRepository } from "./postgres-legacy-backfill.repository";
import { PostgresLegacySnapshotReader } from "./postgres-legacy-snapshot.reader";

export interface LegacyBackfillToolInput {
  database: PostgresDatabase;
  legacyTournamentId: string;
  dryRun?: boolean;
}

/**
 * Programmatic Phase 1 rehearsal/apply entry point. Registration in an admin
 * command or application module is intentionally left to the integration
 * owner after migration rehearsal and approval.
 */
export async function runLegacy2026Backfill(
  input: LegacyBackfillToolInput
): Promise<LegacyBackfillRunResult> {
  const service = new LegacyBackfillService(
    new PostgresLegacySnapshotReader(input.database),
    new PostgresLegacyBackfillRepository(input.database)
  );
  return service.run({
    legacyTournamentId: input.legacyTournamentId,
    dryRun: input.dryRun
  });
}
