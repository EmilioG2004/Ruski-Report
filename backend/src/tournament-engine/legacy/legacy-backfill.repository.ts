import {
  LegacyBackfillPlan,
  LegacyBackfillRecordedState,
  LegacyBackfillRunRecord,
  LegacyTournamentSource
} from "./legacy-backfill.types";

export interface LegacySnapshotReader {
  readActiveSnapshot(
    legacyTournamentId: string
  ): Promise<LegacyTournamentSource | null>;
}

/**
 * The implementation writes canonical engine/backfill tables and may add only
 * the deterministic `match_identities` required to bridge structural bracket
 * nodes that had no pre-existing public match identity. Every pre-existing
 * legacy snapshot, identity, comment, and report row is immutable: it must
 * never be updated or deleted. `apply` is atomic and must roll back if its
 * returned verification state would not match the supplied plan.
 */
export interface LegacyBackfillRepository {
  findRecordedState(
    legacyTournamentId: string
  ): Promise<LegacyBackfillRecordedState | null>;

  apply(
    plan: LegacyBackfillPlan,
    run: LegacyBackfillRunRecord
  ): Promise<LegacyBackfillRecordedState>;

  recordRun(run: LegacyBackfillRunRecord): Promise<void>;
}
