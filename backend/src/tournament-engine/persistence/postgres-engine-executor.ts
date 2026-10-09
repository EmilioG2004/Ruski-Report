import { QueryResult, QueryResultRow } from "pg";

import { PostgresDatabase } from "../../database";
import { getPostgresTransactionClient } from "../../database/postgres-transaction-context";
import { TransactionContext } from "../../repositories/transaction";
import { EngineAuditCommand, EngineMetadata } from "./contracts";

export interface EnginePostgresExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<Row>>;
}

export function engineExecutor(
  database: PostgresDatabase,
  transaction: TransactionContext
): EnginePostgresExecutor {
  return getPostgresTransactionClient(transaction);
}

export async function lockEngineTournament(
  executor: EnginePostgresExecutor,
  tournamentId: string
): Promise<void> {
  await executor.query(
    `
      SELECT pg_advisory_xact_lock(
        hashtextextended('engine:tournament:' || $1::text, 0)
      )
    `,
    [tournamentId]
  );
}

export async function lockEngineMatch(
  executor: EnginePostgresExecutor,
  matchId: string
): Promise<void> {
  await executor.query(
    `
      SELECT pg_advisory_xact_lock(
        hashtextextended('engine:match:' || $1::text, 0)
      )
    `,
    [matchId]
  );
}

export async function writeEngineAuditEvent(
  executor: EnginePostgresExecutor,
  tournamentId: string,
  audit: EngineAuditCommand,
  matchId?: string
): Promise<void> {
  await executor.query(
    `
      INSERT INTO engine_audit_events (
        id, tournament_id, match_id, command_type, actor_kind, actor_id,
        correlation_id, causation_id, occurred_at, details
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
        $7::uuid, $8::uuid, $9, $10::jsonb
      )
    `,
    [
      audit.eventId,
      tournamentId,
      matchId ?? null,
      audit.commandType,
      audit.actor.kind,
      audit.actor.id ?? null,
      audit.correlationId ?? null,
      audit.causationId ?? null,
      audit.occurredAt,
      writeEngineJson(audit.details ?? {})
    ]
  );
}

export function writeEngineJson(value: EngineMetadata | unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Tournament engine values must be JSON-serializable.");
  }
  return serialized;
}
