import { QueryResult, QueryResultRow } from "pg";

import { PostgresDatabase } from "../../database";
import { getPostgresTransactionClient } from "../../database/postgres-transaction-context";
import { TransactionContext } from "../transaction";

export interface PostgresExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<Row>>;
}

export function selectPostgresExecutor(
  database: PostgresDatabase,
  transaction?: TransactionContext
): PostgresExecutor {
  return transaction === undefined
    ? database
    : getPostgresTransactionClient(transaction);
}
