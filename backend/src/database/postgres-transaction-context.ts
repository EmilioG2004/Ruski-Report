import { PoolClient } from "pg";

import { TransactionContext } from "../repositories/transaction";

const postgresClient = Symbol("postgresClient");

export interface PostgresTransactionContext extends TransactionContext {
  [postgresClient]: PoolClient;
}

export function createPostgresTransactionContext(
  transaction: TransactionContext,
  client: PoolClient
): PostgresTransactionContext {
  return {
    ...transaction,
    [postgresClient]: client
  };
}

export function getPostgresTransactionClient(
  transaction: TransactionContext
): PoolClient {
  const client = (transaction as Partial<PostgresTransactionContext>)[
    postgresClient
  ];

  if (client === undefined) {
    throw new Error(
      "PostgreSQL repository received a transaction from another persistence adapter."
    );
  }

  return client;
}
