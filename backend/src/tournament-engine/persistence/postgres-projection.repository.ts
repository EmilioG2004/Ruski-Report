import { PostgresDatabase } from "../../database";
import { TransactionContext } from "../../repositories/transaction";
import {
  ActivateProjectionVersionInput,
  CreateProjectionVersionInput,
  ProjectionRepositoryContract,
  ProjectionActivationResult
} from "./contracts";
import { TournamentEngineTransactionManager } from "./engine-transaction.manager";
import {
  EnginePersistenceConflictError,
  EnginePersistenceInvariantError
} from "./errors";
import {
  engineExecutor,
  EnginePostgresExecutor,
  lockEngineTournament,
  writeEngineAuditEvent,
  writeEngineJson
} from "./postgres-engine-executor";

interface TournamentProjectionRow {
  lifecycle: ProjectionActivationResult["lifecycle"];
  row_version: string | number;
}

interface ProjectionRow {
  status: string;
}

export class PostgresProjectionRepository
implements ProjectionRepositoryContract {
  private readonly transactions: TournamentEngineTransactionManager;

  constructor(
    private readonly database: PostgresDatabase,
    transactions?: TournamentEngineTransactionManager
  ) {
    this.transactions = transactions ?? new TournamentEngineTransactionManager(database);
  }

  createReadyVersion(input: CreateProjectionVersionInput): Promise<void> {
    return this.transactions.run((transaction) =>
      this.createReadyVersionInTransaction(input, transaction)
    );
  }

  activate(
    input: ActivateProjectionVersionInput
  ): Promise<ProjectionActivationResult> {
    return this.transactions.run((transaction) =>
      this.activateInTransaction(input, transaction)
    );
  }

  async createReadyVersionInTransaction(
    input: CreateProjectionVersionInput,
    transaction: TransactionContext
  ): Promise<void> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    await this.lockTournament(executor, input.tournamentId);
    await executor.query(
      `
        INSERT INTO engine_projection_versions (
          tournament_id, version, status, payload_schema_version,
          source_digest, legacy_projection_tournament_id,
          legacy_snapshot_version, created_at, ready_at, metadata
        ) VALUES (
          $1::uuid, $2, 'ready', $3,
          $4, $5, $6, $7, $8, $9::jsonb
        )
      `,
      [
        input.tournamentId,
        input.version,
        input.payloadSchemaVersion,
        input.sourceDigest,
        input.legacyProjection?.tournamentId ?? null,
        input.legacyProjection?.snapshotVersion ?? null,
        input.createdAt,
        input.readyAt,
        writeEngineJson(input.metadata ?? {})
      ]
    );
  }

  async activateInTransaction(
    input: ActivateProjectionVersionInput,
    transaction: TransactionContext
  ): Promise<ProjectionActivationResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const tournament = await this.lockTournament(executor, input.tournamentId);
    if (Number(tournament.row_version) !== input.expectedTournamentRowVersion) {
      throw new EnginePersistenceConflictError(
        "Tournament changed after the projection activation was prepared."
      );
    }

    const projectionResult = await executor.query<ProjectionRow>(
      `
        SELECT status
        FROM engine_projection_versions
        WHERE tournament_id = $1::uuid AND version = $2
        FOR UPDATE
      `,
      [input.tournamentId, input.version]
    );
    const projection = projectionResult.rows[0];
    if (projection === undefined) {
      throw new EnginePersistenceInvariantError(
        "Projection version was not found."
      );
    }
    if (projection.status !== "ready") {
      throw new EnginePersistenceConflictError(
        "Only a ready projection version can be activated."
      );
    }

    const active = await executor.query<{ projection_version: string | number }>(
      `
        SELECT projection_version
        FROM engine_active_projection_versions
        WHERE tournament_id = $1::uuid
        FOR UPDATE
      `,
      [input.tournamentId]
    );
    const previousVersion = active.rows[0]?.projection_version;
    if (previousVersion !== undefined) {
      await executor.query(
        `
          UPDATE engine_projection_versions
          SET status = 'superseded'
          WHERE tournament_id = $1::uuid
            AND version = $2
            AND status = 'active'
        `,
        [input.tournamentId, previousVersion]
      );
    }

    await executor.query(
      `
        UPDATE engine_projection_versions
        SET status = 'active', activated_at = $3
        WHERE tournament_id = $1::uuid AND version = $2 AND status = 'ready'
      `,
      [input.tournamentId, input.version, input.activatedAt]
    );
    await executor.query(
      `
        INSERT INTO engine_active_projection_versions (
          tournament_id, projection_version, activated_at
        ) VALUES ($1::uuid, $2, $3)
        ON CONFLICT (tournament_id) DO UPDATE SET
          projection_version = EXCLUDED.projection_version,
          activated_at = EXCLUDED.activated_at
      `,
      [input.tournamentId, input.version, input.activatedAt]
    );

    const versionResult = await executor.query<{ row_version: string | number }>(
      `
        UPDATE engine_tournaments
        SET row_version = row_version + 1,
            updated_at = $3
        WHERE id = $1::uuid AND row_version = $2
        RETURNING row_version
      `,
      [
        input.tournamentId,
        input.expectedTournamentRowVersion,
        input.activatedAt
      ]
    );
    const rowVersion = versionResult.rows[0]?.row_version;
    if (rowVersion === undefined) {
      throw new EnginePersistenceConflictError(
        "Projection could not be activated at the expected tournament version."
      );
    }

    await writeEngineAuditEvent(executor, input.tournamentId, input.audit);
    return {
      tournamentId: input.tournamentId,
      lifecycle: tournament.lifecycle,
      rowVersion: Number(rowVersion),
      projectionVersion: input.version
    };
  }

  private async lockTournament(
    executor: EnginePostgresExecutor,
    tournamentId: string
  ): Promise<TournamentProjectionRow> {
    const result = await executor.query<TournamentProjectionRow>(
      `
        SELECT lifecycle, row_version
        FROM engine_tournaments
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [tournamentId]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new EnginePersistenceInvariantError("Tournament was not found.");
    }
    return row;
  }
}
