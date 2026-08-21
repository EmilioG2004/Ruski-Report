import { PostgresDatabase } from "../../database";
import { TransactionContext } from "../../repositories/transaction";
import {
  digestCanonicalPublicJson,
  PUBLIC_PROJECTION_CONTRACT_VERSION,
  readCanonicalPublicProjectionSource,
  serializeCanonicalPublicJson
} from "../public-projection";
import { TournamentId } from "../domain";
import {
  ActivateProjectionVersionInput,
  CreateProjectionVersionInput,
  EngineAuditCommand,
  ProjectionActivationResult,
  ProjectionRepositoryContract
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
  payload_schema_version: number;
}

export interface BuildAndActivateCanonicalProjectionInput {
  tournamentId: TournamentId;
  expectedTournamentRowVersion: number;
  createdAt: string;
  activatedAt: string;
  audit: EngineAuditCommand;
}

export interface ReactivateCanonicalProjectionInput {
  tournamentId: TournamentId;
  version: number;
  expectedTournamentRowVersion: number;
  activatedAt: string;
  reason: string;
  audit: EngineAuditCommand;
}

export interface CanonicalProjectionActivationResult
extends ProjectionActivationResult {
  publicTournamentId: string;
  changedMatchIds: readonly string[];
  sourceDigest: string;
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

  buildAndActivateCanonical(
    input: BuildAndActivateCanonicalProjectionInput
  ): Promise<CanonicalProjectionActivationResult> {
    return this.transactions.run((transaction) =>
      this.buildAndActivateCanonicalInTransaction(input, transaction)
    );
  }

  reactivateCanonical(
    input: ReactivateCanonicalProjectionInput
  ): Promise<ProjectionActivationResult> {
    return this.transactions.run((transaction) =>
      this.reactivateCanonicalInTransaction(input, transaction)
    );
  }

  async createReadyVersionInTransaction(
    input: CreateProjectionVersionInput,
    transaction: TransactionContext
  ): Promise<void> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    await this.lockTournament(executor, input.tournamentId);
    await executor.query(`
      INSERT INTO engine_projection_versions (
        tournament_id, version, status, payload_schema_version,
        source_digest, legacy_projection_tournament_id,
        legacy_snapshot_version, created_at, ready_at, metadata
      ) VALUES (
        $1::uuid, $2, 'ready', $3, $4, $5, $6, $7, $8, $9::jsonb
      )
    `, [
      input.tournamentId,
      input.version,
      input.payloadSchemaVersion,
      input.sourceDigest,
      input.legacyProjection?.tournamentId ?? null,
      input.legacyProjection?.snapshotVersion ?? null,
      input.createdAt,
      input.readyAt,
      writeEngineJson(input.metadata ?? {})
    ]);
  }

  async activateInTransaction(
    input: ActivateProjectionVersionInput,
    transaction: TransactionContext
  ): Promise<ProjectionActivationResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const tournament = await this.lockTournament(executor, input.tournamentId);
    this.assertTournamentVersion(tournament, input.expectedTournamentRowVersion);
    await this.requireProjectionStatus(
      executor,
      input.tournamentId,
      input.version,
      "ready"
    );
    await this.switchActiveProjection(executor, {
      tournamentId: input.tournamentId,
      version: input.version,
      activatedAt: input.activatedAt,
      action: "activate",
      audit: input.audit
    });
    return activationResult(input, tournament);
  }

  async buildAndActivateCanonicalInTransaction(
    input: BuildAndActivateCanonicalProjectionInput,
    transaction: TransactionContext
  ): Promise<CanonicalProjectionActivationResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const tournament = await this.lockTournament(executor, input.tournamentId);
    this.assertTournamentVersion(tournament, input.expectedTournamentRowVersion);
    const source = await readCanonicalPublicProjectionSource(
      executor,
      input.tournamentId
    );
    if (source.tournamentRowVersion !== Number(tournament.row_version)) {
      throw new EnginePersistenceConflictError(
        "Canonical projection source changed while it was being captured."
      );
    }
    const version = await this.nextProjectionVersion(executor, input.tournamentId);
    const tournamentSummaryDigest = digestCanonicalPublicJson(
      source.tournamentSummary
    );
    const tournamentDetailDigest = digestCanonicalPublicJson(
      source.tournamentDetail
    );
    const matchDigests = source.matches.map((match) => ({
      id: match.detail.id,
      summary: digestCanonicalPublicJson(match.summary),
      detail: digestCanonicalPublicJson(match.detail)
    }));
    const sourceDigest = digestCanonicalPublicJson({
      contractVersion: PUBLIC_PROJECTION_CONTRACT_VERSION,
      tournamentRowVersion: source.tournamentRowVersion,
      sourcePointers: source.sourcePointers,
      tournamentSummaryDigest,
      tournamentDetailDigest,
      matchDigests
    });
    await this.assertSourceIsNotActive(
      executor,
      input.tournamentId,
      sourceDigest
    );
    await executor.query(`
      INSERT INTO engine_projection_versions (
        tournament_id, version, status, payload_schema_version,
        source_digest, source_tournament_row_version, source_pointers,
        created_at, metadata
      ) VALUES (
        $1::uuid, $2, 'building', $3, $4, $5, $6::jsonb, $7, $8::jsonb
      )
    `, [
      input.tournamentId,
      version,
      PUBLIC_PROJECTION_CONTRACT_VERSION,
      sourceDigest,
      source.tournamentRowVersion,
      serializeCanonicalPublicJson(source.sourcePointers),
      input.createdAt,
      writeEngineJson({ source: "canonical" })
    ]);
    await executor.query(`
      INSERT INTO engine_public_tournament_projection_payloads (
        tournament_id, projection_version, tournament_public_key,
        visibility, lifecycle, year, tournament_summary, tournament_detail,
        tournament_summary_digest, tournament_detail_digest, match_count,
        source_tournament_row_version, source_pointers, created_at
      ) VALUES (
        $1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb,
        $9, $10, $11, $12, $13::jsonb, $14
      )
    `, [
      input.tournamentId,
      version,
      source.tournamentSummary.id,
      source.visibility,
      source.tournamentSummary.lifecycle,
      source.tournamentSummary.year,
      serializeCanonicalPublicJson(source.tournamentSummary),
      serializeCanonicalPublicJson(source.tournamentDetail),
      tournamentSummaryDigest,
      tournamentDetailDigest,
      source.matches.length,
      source.tournamentRowVersion,
      serializeCanonicalPublicJson(source.sourcePointers),
      input.createdAt
    ]);
    for (const match of source.matches) {
      const digests = matchDigests.find((item) => item.id === match.detail.id);
      if (digests === undefined) {
        throw new EnginePersistenceInvariantError(
          "Canonical match digest could not be resolved."
        );
      }
      await executor.query(`
        INSERT INTO engine_public_match_projection_payloads (
          tournament_id, projection_version, match_id, match_public_key,
          summary_payload, detail_payload, summary_digest, detail_digest,
          source_match_row_version, created_at
        ) VALUES (
          $1::uuid, $2, $3::uuid, $4, $5::jsonb, $6::jsonb,
          $7, $8, $9, $10
        )
      `, [
        input.tournamentId,
        version,
        match.engineMatchId,
        match.detail.id,
        serializeCanonicalPublicJson(match.summary),
        serializeCanonicalPublicJson(match.detail),
        digests.summary,
        digests.detail,
        match.sourceMatchRowVersion,
        input.createdAt
      ]);
    }
    await executor.query(`
      UPDATE engine_projection_versions
      SET status = 'ready', ready_at = $3
      WHERE tournament_id = $1::uuid AND version = $2 AND status = 'building'
    `, [input.tournamentId, version, input.createdAt]);
    const changedMatchIds = await this.readChangedMatchIds(
      executor,
      input.tournamentId,
      version
    );
    await this.switchActiveProjection(executor, {
      tournamentId: input.tournamentId,
      version,
      activatedAt: input.activatedAt,
      action: "activate",
      audit: input.audit
    });
    return {
      tournamentId: input.tournamentId,
      lifecycle: tournament.lifecycle,
      rowVersion: Number(tournament.row_version),
      projectionVersion: version,
      publicTournamentId: source.tournamentSummary.id,
      changedMatchIds,
      sourceDigest
    };
  }

  async reactivateCanonicalInTransaction(
    input: ReactivateCanonicalProjectionInput,
    transaction: TransactionContext
  ): Promise<ProjectionActivationResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const tournament = await this.lockTournament(executor, input.tournamentId);
    this.assertTournamentVersion(tournament, input.expectedTournamentRowVersion);
    const target = await this.requireProjectionStatus(
      executor,
      input.tournamentId,
      input.version,
      "superseded"
    );
    if (target.payload_schema_version !== PUBLIC_PROJECTION_CONTRACT_VERSION) {
      throw new EnginePersistenceInvariantError(
        "Only a materialized canonical projection can be reactivated."
      );
    }
    const activeVersion = await this.readActiveVersion(executor, input.tournamentId);
    if (activeVersion === null) {
      throw new EnginePersistenceConflictError(
        "Projection reactivation requires a current active version."
      );
    }
    await this.switchActiveProjection(executor, {
      tournamentId: input.tournamentId,
      version: input.version,
      activatedAt: input.activatedAt,
      action: input.version < activeVersion ? "rollback" : "reactivate",
      reason: input.reason,
      audit: input.audit
    });
    return activationResult(input, tournament);
  }

  private async nextProjectionVersion(
    executor: EnginePostgresExecutor,
    tournamentId: string
  ): Promise<number> {
    const row = (await executor.query<{ version: string | number }>(`
      SELECT COALESCE(MAX(version), 0) + 1 AS version
      FROM engine_projection_versions WHERE tournament_id = $1::uuid
    `, [tournamentId])).rows[0];
    const version = Number(row?.version);
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new EnginePersistenceInvariantError(
        "The next canonical projection version is invalid."
      );
    }
    return version;
  }

  private async assertSourceIsNotActive(
    executor: EnginePostgresExecutor,
    tournamentId: string,
    sourceDigest: string
  ): Promise<void> {
    const active = (await executor.query<{ source_digest: string }>(`
      SELECT projection.source_digest
      FROM engine_active_projection_versions pointer
      JOIN engine_projection_versions projection
        ON projection.tournament_id = pointer.tournament_id
       AND projection.version = pointer.projection_version
      WHERE pointer.tournament_id = $1::uuid
      FOR UPDATE OF pointer, projection
    `, [tournamentId])).rows[0];
    if (active?.source_digest === sourceDigest) {
      throw new EnginePersistenceConflictError(
        "The same canonical source is already the active public projection."
      );
    }
  }

  private async readChangedMatchIds(
    executor: EnginePostgresExecutor,
    tournamentId: string,
    version: number
  ): Promise<string[]> {
    return (await executor.query<{ match_public_key: string }>(`
      WITH previous AS (
        SELECT payload.match_public_key, payload.summary_digest,
               payload.detail_digest
        FROM engine_active_projection_versions active
        JOIN engine_public_match_projection_payloads payload
          ON payload.tournament_id = active.tournament_id
         AND payload.projection_version = active.projection_version
        WHERE active.tournament_id = $1::uuid
      ), next AS (
        SELECT match_public_key, summary_digest, detail_digest
        FROM engine_public_match_projection_payloads
        WHERE tournament_id = $1::uuid AND projection_version = $2
      )
      SELECT COALESCE(next.match_public_key, previous.match_public_key)
        AS match_public_key
      FROM previous FULL OUTER JOIN next USING (match_public_key)
      WHERE previous.match_public_key IS NULL OR next.match_public_key IS NULL
         OR previous.summary_digest <> next.summary_digest
         OR previous.detail_digest <> next.detail_digest
      ORDER BY match_public_key
    `, [tournamentId, version])).rows.map((row) => row.match_public_key);
  }

  private async switchActiveProjection(
    executor: EnginePostgresExecutor,
    input: {
      tournamentId: string;
      version: number;
      activatedAt: string;
      action: "activate" | "reactivate" | "rollback";
      reason?: string;
      audit: EngineAuditCommand;
    }
  ): Promise<void> {
    const previousVersion = await this.readActiveVersion(
      executor,
      input.tournamentId
    );
    if (previousVersion !== null) {
      await executor.query(`
        UPDATE engine_projection_versions SET status = 'superseded'
        WHERE tournament_id = $1::uuid AND version = $2 AND status = 'active'
      `, [input.tournamentId, previousVersion]);
    }
    const activated = await executor.query(`
      UPDATE engine_projection_versions
      SET status = 'active', activated_at = $3
      WHERE tournament_id = $1::uuid AND version = $2
        AND status IN ('ready', 'superseded')
    `, [input.tournamentId, input.version, input.activatedAt]);
    if (activated.rowCount !== 1) {
      throw new EnginePersistenceConflictError(
        "Projection could not be activated from its current state."
      );
    }
    await executor.query(`
      INSERT INTO engine_active_projection_versions (
        tournament_id, projection_version, activated_at
      ) VALUES ($1::uuid, $2, $3)
      ON CONFLICT (tournament_id) DO UPDATE SET
        projection_version = EXCLUDED.projection_version,
        activated_at = EXCLUDED.activated_at
    `, [input.tournamentId, input.version, input.activatedAt]);
    await writeEngineAuditEvent(executor, input.tournamentId, input.audit);
    await executor.query(`
      INSERT INTO engine_public_projection_activations (
        audit_event_id, tournament_id, previous_projection_version,
        projection_version, action, reason, activated_at, metadata
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb)
    `, [
      input.audit.eventId,
      input.tournamentId,
      previousVersion,
      input.version,
      input.action,
      input.reason ?? null,
      input.activatedAt,
      writeEngineJson({ source: "canonical_projection_repository" })
    ]);
  }

  private async readActiveVersion(
    executor: EnginePostgresExecutor,
    tournamentId: string
  ): Promise<number | null> {
    const row = (await executor.query<{ projection_version: string | number }>(`
      SELECT projection_version FROM engine_active_projection_versions
      WHERE tournament_id = $1::uuid FOR UPDATE
    `, [tournamentId])).rows[0];
    return row === undefined ? null : Number(row.projection_version);
  }

  private async requireProjectionStatus(
    executor: EnginePostgresExecutor,
    tournamentId: string,
    version: number,
    status: "ready" | "superseded"
  ): Promise<ProjectionRow> {
    const row = (await executor.query<ProjectionRow>(`
      SELECT status, payload_schema_version FROM engine_projection_versions
      WHERE tournament_id = $1::uuid AND version = $2 FOR UPDATE
    `, [tournamentId, version])).rows[0];
    if (row === undefined) {
      throw new EnginePersistenceInvariantError("Projection version was not found.");
    }
    if (row.status !== status) {
      throw new EnginePersistenceConflictError(
        `Projection version must be ${status} before activation.`
      );
    }
    return row;
  }

  private async lockTournament(
    executor: EnginePostgresExecutor,
    tournamentId: string
  ): Promise<TournamentProjectionRow> {
    const row = (await executor.query<TournamentProjectionRow>(`
      SELECT lifecycle, row_version FROM engine_tournaments
      WHERE id = $1::uuid FOR UPDATE
    `, [tournamentId])).rows[0];
    if (row === undefined) {
      throw new EnginePersistenceInvariantError("Tournament was not found.");
    }
    return row;
  }

  private assertTournamentVersion(
    tournament: TournamentProjectionRow,
    expected: number
  ): void {
    if (Number(tournament.row_version) !== expected) {
      throw new EnginePersistenceConflictError(
        "Tournament changed after the projection was prepared."
      );
    }
  }
}

function activationResult(
  input: { tournamentId: TournamentId; version: number },
  tournament: TournamentProjectionRow
): ProjectionActivationResult {
  return {
    tournamentId: input.tournamentId,
    lifecycle: tournament.lifecycle,
    rowVersion: Number(tournament.row_version),
    projectionVersion: input.version
  };
}
