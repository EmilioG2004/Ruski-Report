import { PoolClient } from "pg";

import { PostgresDatabase } from "./postgres-database";
import { getPostgresTransactionClient } from "./postgres-transaction-context";
import { PostgresTransactionManager } from "./postgres-transaction.manager";

describe("PostgresTransactionManager", () => {
  it("commits work on the checked-out transaction client", async () => {
    const client = createClient();
    const manager = createManager(client);

    const value = await manager.runInTransaction(async (transaction) => {
      expect(getPostgresTransactionClient(transaction)).toBe(client);
      await getPostgresTransactionClient(transaction).query("SELECT 1");
      return "committed";
    });

    expect(value).toBe("committed");
    expect(client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(client.query).toHaveBeenNthCalledWith(2, "SELECT 1");
    expect(client.query).toHaveBeenNthCalledWith(3, "COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases the client when work fails", async () => {
    const client = createClient();
    const manager = createManager(client);

    await expect(
      manager.runInTransaction(async () => {
        throw new Error("write failed");
      })
    ).rejects.toThrow("write failed");

    expect(client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(client.query).toHaveBeenNthCalledWith(2, "ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

function createManager(client: jest.Mocked<PoolClient>) {
  const database = {
    connect: jest.fn().mockResolvedValue(client)
  } as unknown as PostgresDatabase;
  return new PostgresTransactionManager(database);
}

function createClient(): jest.Mocked<PoolClient> {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn()
  } as unknown as jest.Mocked<PoolClient>;
}
