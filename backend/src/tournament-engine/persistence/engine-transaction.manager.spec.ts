import { PoolClient } from "pg";

import { PostgresDatabase } from "../../database";
import { getPostgresTransactionClient } from "../../database/postgres-transaction-context";
import { TournamentEngineTransactionManager } from "./engine-transaction.manager";

describe("TournamentEngineTransactionManager", () => {
  it("commits a serializable command on its transaction-scoped client", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const release = jest.fn();
    const client = { query, release } as unknown as PoolClient;
    const database = {
      connect: jest.fn().mockResolvedValue(client)
    } as unknown as PostgresDatabase;
    const transactions = new TournamentEngineTransactionManager(database);

    const result = await transactions.run(async (transaction) => {
      expect(getPostgresTransactionClient(transaction)).toBe(client);
      await getPostgresTransactionClient(transaction).query("SELECT 1");
      return "committed";
    });

    expect(result).toBe("committed");
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE",
      "SELECT 1",
      "COMMIT"
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases the client when a command fails", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const release = jest.fn();
    const client = { query, release } as unknown as PoolClient;
    const database = {
      connect: jest.fn().mockResolvedValue(client)
    } as unknown as PostgresDatabase;
    const transactions = new TournamentEngineTransactionManager(database);

    await expect(
      transactions.run(async () => {
        throw new Error("command failed");
      }, { isolationLevel: "repeatable read", readOnly: true })
    ).rejects.toThrow("command failed");

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      "ROLLBACK"
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
