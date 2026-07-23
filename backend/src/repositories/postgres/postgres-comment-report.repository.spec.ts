import { PoolClient } from "pg";

import {
  createPostgresTransactionContext
} from "../../database/postgres-transaction-context";
import { PostgresDatabase } from "../../database";
import { PostgresCommentReportRepository } from "./postgres-comment-report.repository";

const transaction = {
  id: "transaction-1",
  startedAt: "2026-07-23T12:00:00.000Z"
};

describe("PostgresCommentReportRepository", () => {
  it("locks by reporter and returns an existing duplicate before rate limiting", async () => {
    const client = createClient();
    client.query
      .mockResolvedValueOnce(queryResult([{}]))
      .mockResolvedValueOnce(queryResult([reportRow()]));
    const repository = createRepository();

    const result = await repository.submit(
      submitInput(),
      rateLimit(),
      context(client)
    );

    expect(result.ok && result.value).toMatchObject({
      status: "existing",
      report: { id: "report-1" }
    });
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[0]?.[0]).toContain(
      "pg_advisory_xact_lock"
    );
    expect(client.query.mock.calls[1]?.[0]).toContain(
      "reported_comment_id"
    );
  });

  it("checks the persisted rate window before inserting", async () => {
    const client = createClient();
    client.query
      .mockResolvedValueOnce(queryResult([{}]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(
        queryResult([
          {
            report_count: "0",
            oldest_created_at: null
          }
        ])
      )
      .mockResolvedValueOnce(queryResult([reportRow()]));
    const repository = createRepository();

    const result = await repository.submit(
      submitInput(),
      rateLimit(),
      context(client)
    );

    expect(result.ok && result.value).toMatchObject({
      status: "created",
      report: {
        id: "report-1",
        reportedCommentId: "comment-1",
        reporterUserId: "user-1"
      }
    });
    expect(client.query).toHaveBeenCalledTimes(4);
    expect(client.query.mock.calls[2]?.[0]).toContain("min(created_at)");
    expect(client.query.mock.calls[3]?.[0]).toContain(
      "INSERT INTO comment_reports"
    );
  });

  it("returns a deterministic retry delay when the rate window is full", async () => {
    const client = createClient();
    client.query
      .mockResolvedValueOnce(queryResult([{}]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(
        queryResult([
          {
            report_count: "5",
            oldest_created_at: "2026-07-23T11:55:00.000Z"
          }
        ])
      );
    const repository = createRepository();

    const result = await repository.submit(
      submitInput(),
      rateLimit(),
      context(client)
    );

    expect(result).toEqual({
      ok: true,
      value: {
        status: "rate_limited",
        retryAfterSeconds: 300
      }
    });
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  it("serializes moderation actions by reported comment before row locking", async () => {
    const client = createClient();
    client.query
      .mockResolvedValueOnce(
        queryResult([{ reported_comment_id: "comment-1" }])
      )
      .mockResolvedValueOnce(queryResult([{}]))
      .mockResolvedValueOnce(queryResult([reportRow()]));
    const repository = createRepository();

    const result = await repository.findByIdForUpdate(
      "report-1",
      context(client)
    );

    expect(result.ok && result.value?.id).toBe("report-1");
    expect(client.query.mock.calls[0]?.[0]).toContain(
      "reported_comment_id"
    );
    expect(client.query.mock.calls[1]?.[0]).toContain(
      "comment-moderation:"
    );
    expect(client.query.mock.calls[2]?.[0]).toContain("FOR UPDATE");
  });

  it("can resolve every active report for a removed comment", async () => {
    const client = createClient();
    client.query.mockResolvedValueOnce(queryResult([reportRow({
      status: "resolved",
      reviewed_at: "2026-07-23T12:05:00.000Z",
      resolved_at: "2026-07-23T12:05:00.000Z",
      resolution: "comment_removed",
      moderator_id: "operator-1"
    })]));
    const repository = createRepository();

    const result = await repository.resolve(
      {
        reportId: "report-1",
        reportedCommentId: "comment-1",
        resolution: "comment_removed",
        moderatorId: "operator-1",
        resolvedAt: "2026-07-23T12:05:00.000Z",
        resolveAllForComment: true
      },
      context(client)
    );

    expect(result.ok && result.value).toMatchObject({
      status: "resolved",
      report: {
        status: "resolved",
        resolution: "comment_removed"
      }
    });
    expect(client.query.mock.calls[0]?.[0]).toContain(
      "reported_comment_id = $2"
    );
    expect(client.query.mock.calls[0]?.[1]?.[6]).toBe(true);
  });
});

function submitInput() {
  return {
    id: "report-1",
    commentId: "comment-1",
    matchId: "match-1",
    reporterUserId: "user-1",
    reason: "harassment" as const,
    context: "Please review.",
    createdAt: "2026-07-23T12:00:00.000Z"
  };
}

function rateLimit() {
  return {
    earliestCreatedAt: "2026-07-23T11:50:00.000Z",
    now: "2026-07-23T12:00:00.000Z",
    maximumReports: 5,
    windowSeconds: 600
  };
}

function reportRow(
  overrides: Record<string, unknown> = {}
) {
  return { ...baseReportRow(), ...overrides };
}

function baseReportRow() {
  return {
    id: "report-1",
    comment_id: "comment-1",
    reported_comment_id: "comment-1",
    match_id: "match-1",
    reporter_user_id: "user-1",
    reason: "harassment",
    context: "Please review.",
    status: "open",
    created_at: "2026-07-23T12:00:00.000Z",
    reviewed_at: null,
    resolved_at: null,
    resolution: null,
    moderator_id: null,
    resolution_note: null,
    metadata: {}
  };
}

function createRepository(): PostgresCommentReportRepository {
  return new PostgresCommentReportRepository({} as PostgresDatabase);
}

function context(client: ReturnType<typeof createClient>) {
  return createPostgresTransactionContext(
    transaction,
    client as unknown as PoolClient
  );
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
