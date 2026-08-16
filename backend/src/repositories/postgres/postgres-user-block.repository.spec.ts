import { PoolClient } from "pg";

import { PostgresDatabase } from "../../database";
import {
  createPostgresTransactionContext
} from "../../database/postgres-transaction-context";
import { PostgresUserBlockRepository } from "./postgres-user-block.repository";

const transaction = {
  id: "transaction-1",
  startedAt: "2026-07-23T12:00:00.000Z"
};

describe("PostgresUserBlockRepository", () => {
  it("uses the existing row to make block creation idempotent", async () => {
    const client = createClient();
    client.query
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([blockRow()]));
    const repository = new PostgresUserBlockRepository(
      {} as PostgresDatabase
    );

    const result = await repository.block(
      blockInput(),
      createPostgresTransactionContext(
        transaction,
        client as unknown as PoolClient
      )
    );

    expect(result.ok && result.value).toEqual({
      status: "existing",
      block: {
        blockerUserId: "viewer-1",
        blockedUserId: "target-1",
        createdAt: "2026-07-23T12:00:00.000Z"
      }
    });
    expect(client.query.mock.calls[0]?.[0]).toContain("ON CONFLICT");
    expect(client.query.mock.calls[1]?.[0]).toContain("FROM user_blocks");
  });

  it("lists blocked accounts in a deterministic order", async () => {
    const database = {
      query: jest.fn().mockResolvedValue(
        queryResult([
          {
            user_id: "target-1",
            display_name: "Target",
            blocked_at: "2026-07-23T12:00:00.000Z"
          }
        ])
      )
    } as unknown as PostgresDatabase;
    const repository = new PostgresUserBlockRepository(database);

    const result = await repository.listBlockedUsers("viewer-1");

    expect(result.ok && result.value[0]).toEqual({
      userId: "target-1",
      displayName: "Target",
      blockedAt: "2026-07-23T12:00:00.000Z"
    });
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "ORDER BY block.created_at DESC, block.blocked_user_id"
      ),
      ["viewer-1"]
    );
  });

  it("returns whether an unblock changed persisted state", async () => {
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce(queryResult([{ blocked_user_id: "target-1" }]))
        .mockResolvedValueOnce(queryResult([]))
    } as unknown as PostgresDatabase;
    const repository = new PostgresUserBlockRepository(database);

    await expect(repository.unblock("viewer-1", "target-1")).resolves.toEqual({
      ok: true,
      value: { wasBlocked: true }
    });
    await expect(repository.unblock("viewer-1", "target-1")).resolves.toEqual({
      ok: true,
      value: { wasBlocked: false }
    });
  });
});

function blockInput() {
  return {
    blockerUserId: "viewer-1",
    blockedUser: {
      userId: "target-1",
      displayName: "Target"
    },
    createdAt: "2026-07-23T12:00:00.000Z"
  };
}

function blockRow() {
  return {
    blocker_user_id: "viewer-1",
    blocked_user_id: "target-1",
    created_at: "2026-07-23T12:00:00.000Z"
  };
}

function createClient() {
  return {
    query: jest.fn(),
    release: jest.fn()
  };
}

function queryResult(rows: unknown[]) {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
  };
}
