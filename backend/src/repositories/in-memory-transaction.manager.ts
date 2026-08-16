import { randomUUID } from "crypto";

import { TransactionContext, TransactionManager } from "./transaction";

export class InMemoryTransactionManager implements TransactionManager {
  async runInTransaction<T>(
    operation: (transaction: TransactionContext) => Promise<T>
  ): Promise<T> {
    return operation({
      id: randomUUID(),
      startedAt: new Date().toISOString()
    });
  }
}
