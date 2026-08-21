import { TransactionContext } from "../../repositories/transaction";

export interface CanonicalScoringMaterializationInput {
  readonly matchId: string;
  readonly revisionId: string;
  readonly candidateId: string;
  readonly confirmationDigest: string;
  readonly adapterVersion: number;
  readonly materializedByAdminId: string;
  readonly writerFencingToken: number;
  readonly materializedAt: string;
}

export interface CanonicalScoringBatchPersistenceInput {
  readonly tournamentId: string;
  readonly rulesVersion: number;
  readonly calculatedAt: string;
  readonly materializations: readonly CanonicalScoringMaterializationInput[];
}

export interface CanonicalScoringMaterializationResult {
  readonly matchId: string;
  readonly revisionId: string;
  readonly candidateId: string;
  readonly matchStatisticRunId: string;
}

export interface CanonicalScoringBatchPersistenceResult {
  readonly materialized: readonly CanonicalScoringMaterializationResult[];
  readonly tournamentStatisticRunId: string;
  readonly tournamentStatisticRunDigest: string;
}

export interface CanonicalStatisticPersistenceContract {
  persistMaterializedBatchInTransaction(
    input: CanonicalScoringBatchPersistenceInput,
    transaction: TransactionContext
  ): Promise<CanonicalScoringBatchPersistenceResult>;
}

