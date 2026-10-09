import { PostgresDatabase } from "../../database";
import { TransactionContext } from "../../repositories/transaction";
import { ScoringWriterMode } from "../domain";
import {
  AcquireMatchWriterInput,
  MatchWriterRepositoryContract,
  MatchWriterLeaseResult,
  ReleaseMatchWriterInput
} from "./contracts";
import { TournamentEngineTransactionManager } from "./engine-transaction.manager";
import {
  EnginePersistenceInvariantError,
  EngineWriterLeaseConflictError
} from "./errors";
import {
  engineExecutor,
  EnginePostgresExecutor,
  lockEngineMatch,
  lockEngineTournament
} from "./postgres-engine-executor";

interface WriterLeaseRow {
  mode: ScoringWriterMode;
  holder_id: string;
  fencing_token: string | number;
  expires_at: Date | string;
  released_at: Date | string | null;
  active: boolean;
}

interface AcquiredWriterLeaseRow {
  fencing_token: string | number;
  expires_at: Date | string;
}

export class PostgresMatchWriterRepository
implements MatchWriterRepositoryContract {
  private readonly transactions: TournamentEngineTransactionManager;

  constructor(
    private readonly database: PostgresDatabase,
    transactions?: TournamentEngineTransactionManager
  ) {
    this.transactions = transactions ?? new TournamentEngineTransactionManager(database);
  }

  acquire(input: AcquireMatchWriterInput): Promise<MatchWriterLeaseResult> {
    return this.transactions.run((transaction) =>
      this.acquireInTransaction(input, transaction)
    );
  }

  release(input: ReleaseMatchWriterInput): Promise<boolean> {
    return this.transactions.run((transaction) =>
      this.releaseInTransaction(input, transaction)
    );
  }

  async acquireInTransaction(
    input: AcquireMatchWriterInput,
    transaction: TransactionContext
  ): Promise<MatchWriterLeaseResult> {
    const requestedAcquiredAt = Date.parse(input.acquiredAt);
    const requestedExpiresAt = Date.parse(input.expiresAt);
    const requestedDurationMilliseconds = requestedExpiresAt - requestedAcquiredAt;
    if (
      !Number.isFinite(requestedAcquiredAt) ||
      !Number.isFinite(requestedExpiresAt) ||
      !Number.isSafeInteger(requestedDurationMilliseconds) ||
      requestedDurationMilliseconds <= 0
    ) {
      throw new EnginePersistenceInvariantError(
        "Writer lease timestamps must define a positive finite duration."
      );
    }

    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    await lockEngineMatch(executor, input.matchId);
    await assertMatchScope(executor, input.tournamentId, input.matchId);
    const existing = await lockWriterLease(executor, input.matchId);

    if (
      existing !== undefined &&
      existing.active
    ) {
      return {
        acquired: false,
        activeMode: existing.mode,
        activeHolderId: existing.holder_id,
        expiresAt: new Date(existing.expires_at).toISOString()
      };
    }

    const fencingToken = Number(existing?.fencing_token ?? 0) + 1;
    const acquired = await executor.query<AcquiredWriterLeaseRow>(
      `
        WITH server_time AS (
          SELECT clock_timestamp() AS acquired_at
        )
        INSERT INTO engine_match_writer_leases (
          match_id, mode, holder_id, fencing_token, acquired_at, expires_at,
          released_at, metadata
        )
        SELECT $1::uuid, $2, $3, $4,
               server_time.acquired_at,
               server_time.acquired_at + ($5::bigint * interval '1 millisecond'),
               NULL,
               '{}'::jsonb
        FROM server_time
        ON CONFLICT (match_id) DO UPDATE SET
          mode = EXCLUDED.mode,
          holder_id = EXCLUDED.holder_id,
          fencing_token = EXCLUDED.fencing_token,
          acquired_at = EXCLUDED.acquired_at,
          expires_at = EXCLUDED.expires_at,
          released_at = NULL,
          metadata = EXCLUDED.metadata
        RETURNING fencing_token, expires_at
      `,
      [
        input.matchId,
        input.mode,
        input.holderId,
        fencingToken,
        requestedDurationMilliseconds
      ]
    );
    const storedLease = acquired.rows[0];
    if (storedLease === undefined) {
      throw new EnginePersistenceInvariantError(
        "Writer lease acquisition did not return its server-owned expiration."
      );
    }

    return {
      acquired: true,
      fencingToken: Number(storedLease.fencing_token),
      expiresAt: new Date(storedLease.expires_at).toISOString()
    };
  }

  async releaseInTransaction(
    input: ReleaseMatchWriterInput,
    transaction: TransactionContext
  ): Promise<boolean> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    await lockEngineMatch(executor, input.matchId);
    await assertMatchScope(executor, input.tournamentId, input.matchId);
    const released = await executor.query(
      `
        UPDATE engine_match_writer_leases
        SET released_at = clock_timestamp()
        WHERE match_id = $1::uuid
          AND holder_id = $2
          AND fencing_token = $3
          AND released_at IS NULL
      `,
      [
        input.matchId,
        input.holderId,
        input.fencingToken
      ]
    );
    return released.rowCount === 1;
  }
}

export async function assertEngineWriterFence(
  executor: EnginePostgresExecutor,
  input: {
    matchId: string;
    mode: ScoringWriterMode;
    holderId: string;
    fencingToken: number;
    checkedAt: string;
  }
): Promise<void> {
  if (!Number.isFinite(Date.parse(input.checkedAt))) {
    throw new EnginePersistenceInvariantError(
      "Writer fence observation time must be a valid timestamp."
    );
  }
  const result = await executor.query<WriterLeaseRow>(
    `
      SELECT mode, holder_id, fencing_token, expires_at, released_at,
             released_at IS NULL AND expires_at > clock_timestamp() AS active
      FROM engine_match_writer_leases
      WHERE match_id = $1::uuid
      FOR UPDATE
    `,
    [input.matchId]
  );
  const lease = result.rows[0];
  const valid =
    lease !== undefined &&
    lease.mode === input.mode &&
    lease.holder_id === input.holderId &&
    Number(lease.fencing_token) === input.fencingToken &&
    lease.active;

  if (!valid) {
    throw new EngineWriterLeaseConflictError(
      "The match writer lease is missing, expired, released, or superseded."
    );
  }
}

async function assertMatchScope(
  executor: EnginePostgresExecutor,
  tournamentId: string,
  matchId: string
): Promise<void> {
  const result = await executor.query(
    `
      SELECT 1
      FROM engine_matches
      WHERE id = $1::uuid
        AND tournament_id = $2::uuid
        AND NOT identity_only
      FOR UPDATE
    `,
    [matchId, tournamentId]
  );
  if (result.rows[0] === undefined) {
    throw new EnginePersistenceInvariantError(
      "Writable match was not found in the selected tournament."
    );
  }
}

async function lockWriterLease(
  executor: EnginePostgresExecutor,
  matchId: string
): Promise<WriterLeaseRow | undefined> {
  const result = await executor.query<WriterLeaseRow>(
    `
      SELECT mode, holder_id, fencing_token, expires_at, released_at,
             released_at IS NULL AND expires_at > clock_timestamp() AS active
      FROM engine_match_writer_leases
      WHERE match_id = $1::uuid
      FOR UPDATE
    `,
    [matchId]
  );
  return result.rows[0];
}
