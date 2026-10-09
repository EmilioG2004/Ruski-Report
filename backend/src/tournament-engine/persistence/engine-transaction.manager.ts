import { randomUUID } from "node:crypto";

import { PostgresDatabase } from "../../database";
import { createPostgresTransactionContext } from "../../database/postgres-transaction-context";
import { TransactionContext } from "../../repositories/transaction";

export type EngineIsolationLevel =
  | "read committed"
  | "repeatable read"
  | "serializable";

export interface EngineTransactionOptions {
  isolationLevel?: EngineIsolationLevel;
  readOnly?: boolean;
}

export class TournamentEngineTransactionManager {
  constructor(private readonly database: PostgresDatabase) {}

  async run<T>(
    operation: (transaction: TransactionContext) => Promise<T>,
    options: EngineTransactionOptions = {}
  ): Promise<T> {
    const client = await this.database.connect();
    const isolation = toSqlIsolation(options.isolationLevel ?? "serializable");
    const accessMode = options.readOnly === true ? "READ ONLY" : "READ WRITE";

    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation} ${accessMode}`);
      const transaction = createPostgresTransactionContext(
        {
          id: randomUUID(),
          startedAt: new Date().toISOString(),
          metadata: {
            adapter: "postgresql",
            boundary: "tournament_engine",
            isolationLevel: options.isolationLevel ?? "serializable",
            readOnly: options.readOnly ?? false
          }
        },
        client
      );
      const result = await operation(transaction);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function toSqlIsolation(level: EngineIsolationLevel): string {
  switch (level) {
  case "read committed":
    return "READ COMMITTED";
  case "repeatable read":
    return "REPEATABLE READ";
  case "serializable":
    return "SERIALIZABLE";
  }
}
