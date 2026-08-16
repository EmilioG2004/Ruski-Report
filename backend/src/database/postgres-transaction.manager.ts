import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { TransactionContext, TransactionManager } from "../repositories/transaction";
import { PostgresDatabase } from "./postgres-database";
import { createPostgresTransactionContext } from "./postgres-transaction-context";

@Injectable()
export class PostgresTransactionManager implements TransactionManager {
  constructor(private readonly database: PostgresDatabase) {}

  async runInTransaction<T>(
    operation: (transaction: TransactionContext) => Promise<T>
  ): Promise<T> {
    const client = await this.database.connect();

    try {
      await client.query("BEGIN");
      const result = await operation(
        createPostgresTransactionContext(
          {
            id: randomUUID(),
            startedAt: new Date().toISOString(),
            metadata: { adapter: "postgresql" }
          },
          client
        )
      );
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
