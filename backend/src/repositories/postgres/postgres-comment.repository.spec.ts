import { PoolClient } from "pg";

import {
  createPostgresTransactionContext
} from "../../database/postgres-transaction-context";
import { PostgresDatabase } from "../../database";
import { PostgresCommentRepository } from "./postgres-comment.repository";

interface RecordingClient {
  query: jest.Mock;
  release: jest.Mock;
}

const transaction = {
  id: "transaction-1",
  startedAt: "2026-07-23T12:00:00.000Z"
};

describe("PostgresCommentRepository moderation writes", () => {
  it("takes a transaction lock before checking for a recent duplicate", async () => {
    const client = createClient();
    client.query
      .mockResolvedValueOnce(queryResult([{}]))
      .mockResolvedValueOnce(queryResult([{ exists: true }]));
    const repository = createRepository();

    const result = await repository.createUnlessRecentDuplicate(
      commentInput(),
      "2026-07-23T11:55:00.000Z",
      createPostgresTransactionContext(transaction, client as unknown as PoolClient)
    );

    expect(result).toEqual({
      ok: true,
      value: { status: "duplicate" }
    });
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[0]?.[0]).toContain(
      "pg_advisory_xact_lock"
    );
    expect(client.query.mock.calls[1]?.[0]).toContain(
      "normalized_body_hash = $3"
    );
  });

  it("inserts only after the locked duplicate check succeeds", async () => {
    const client = createClient();
    client.query
      .mockResolvedValueOnce(queryResult([{}]))
      .mockResolvedValueOnce(queryResult([{ exists: false }]))
      .mockResolvedValueOnce(
        queryResult([
          {
            id: "comment-1",
            match_id: "match-1",
            author_kind: "account",
            author_display_name: "Alex",
            author_user_id: "user-1",
            body: "Great match.",
            created_at: "2026-07-23T12:00:00.000Z",
            updated_at: null,
            deleted_at: null,
            metadata: {}
          }
        ])
      );
    const repository = createRepository();

    const result = await repository.createUnlessRecentDuplicate(
      commentInput(),
      "2026-07-23T11:55:00.000Z",
      createPostgresTransactionContext(transaction, client as unknown as PoolClient)
    );

    expect(result.ok && result.value).toMatchObject({
      status: "created",
      comment: {
        matchId: "match-1",
        body: "Great match."
      }
    });
    expect(client.query).toHaveBeenCalledTimes(3);
    expect(client.query.mock.calls[2]?.[0]).toContain(
      "normalized_body_hash"
    );
  });

  it("rejects moderated writes without an identity or fingerprint", async () => {
    const client = createClient();
    const repository = createRepository();

    const result = await repository.createUnlessRecentDuplicate(
      {
        matchId: "match-1",
        author: {
          kind: "account",
          displayName: "Alex"
        },
        body: "Great match."
      },
      "2026-07-23T11:55:00.000Z",
      createPostgresTransactionContext(transaction, client as unknown as PoolClient)
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "validation_failed" }
    });
    expect(client.query).not.toHaveBeenCalled();
  });
});

function commentInput() {
  return {
    matchId: "match-1",
    author: {
      kind: "account" as const,
      displayName: "Alex",
      userId: "user-1"
    },
    body: "Great match.",
    normalizedBodyHash: "a".repeat(64)
  };
}

function createRepository(): PostgresCommentRepository {
  return new PostgresCommentRepository({} as PostgresDatabase);
}

function createClient(): RecordingClient {
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
