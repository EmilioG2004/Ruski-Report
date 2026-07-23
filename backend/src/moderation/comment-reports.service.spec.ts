import { AuthenticatedPrincipal } from "../domain";
import { AppError } from "../errors";
import { AppLogger } from "../logging";
import {
  InMemoryCommentReportRepository,
  InMemoryCommentRepository,
  InMemoryTransactionManager
} from "../repositories";
import { CommentReportingConfig } from "../config/comment-reporting.config";
import { CommentReportClock } from "./comment-report-clock";
import { DefaultCommentReportPolicy } from "./comment-report.policy";
import { CommentReportsService } from "./comment-reports.service";

const principal: AuthenticatedPrincipal = {
  userId: "user-reporter",
  displayName: "Reporter",
  provider: "local_account",
  sessionId: "session-1",
  expiresAt: "2026-08-01T00:00:00.000Z"
};

describe("CommentReportsService", () => {
  it("submits a normalized report without logging its private context", async () => {
    const dependencies = await createDependencies();

    const receipt = await dependencies.service.submit(
      dependencies.commentId,
      {
        reason: "harassment",
        context: "  Repeated\tinsults.  "
      },
      principal
    );

    expect(receipt).toMatchObject({
      status: "open",
      alreadyReported: false,
      submittedAt: "2026-07-23T12:00:00.000Z"
    });
    const reports = await dependencies.reports.list("open", 10);
    expect(reports.ok && reports.value[0].report).toMatchObject({
      reason: "harassment",
      context: "Repeated insults.",
      reporterUserId: principal.userId
    });
    expect(JSON.stringify(dependencies.logger.info.mock.calls)).not.toContain(
      "Repeated insults."
    );
    expect(JSON.stringify(dependencies.logger.info.mock.calls)).not.toContain(
      principal.userId
    );
  });

  it("returns the original receipt for a duplicate report", async () => {
    const dependencies = await createDependencies();

    const first = await dependencies.service.submit(
      dependencies.commentId,
      { reason: "spam" },
      principal
    );
    const repeated = await dependencies.service.submit(
      dependencies.commentId,
      { reason: "harassment" },
      principal
    );

    expect(repeated).toEqual({
      ...first,
      alreadyReported: true
    });
    const reports = await dependencies.reports.list("open", 10);
    expect(reports.ok && reports.value).toHaveLength(1);
  });

  it("rejects unavailable comments with a stable error", async () => {
    const dependencies = await createDependencies();

    await expect(
      dependencies.service.submit(
        "missing-comment",
        { reason: "spam" },
        principal
      )
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      details: [
        expect.objectContaining({ code: "COMMENT_NOT_AVAILABLE" })
      ]
    } satisfies Partial<AppError>);
  });

  it("enforces the persisted reporter rate limit", async () => {
    const dependencies = await createDependencies({
      maximumReportsPerWindow: 1
    });
    const secondComment = await dependencies.comments.create({
      matchId: "match-2026-001",
      author: {
        kind: "account",
        displayName: "Another",
        userId: "user-another"
      },
      body: "Another comment."
    });
    if (!secondComment.ok) {
      throw new Error("Unable to seed second comment.");
    }

    await dependencies.service.submit(
      dependencies.commentId,
      { reason: "spam" },
      principal
    );
    await expect(
      dependencies.service.submit(
        secondComment.value.id,
        { reason: "spam" },
        principal
      )
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      statusCode: 429,
      details: [
        expect.objectContaining({
          code: "COMMENT_REPORT_RATE_LIMITED",
          metadata: { retryAfterSeconds: 600 }
        })
      ]
    } satisfies Partial<AppError>);
  });

  it("rejects invalid input before reading persistence", async () => {
    const dependencies = await createDependencies({
      maximumContextLength: 5
    });

    await expect(
      dependencies.service.submit(
        dependencies.commentId,
        { reason: "other", context: " " },
        principal
      )
    ).rejects.toMatchObject({
      details: [
        expect.objectContaining({
          code: "COMMENT_REPORT_CONTEXT_REQUIRED"
        })
      ]
    });
    await expect(
      dependencies.service.submit(
        dependencies.commentId,
        { reason: "spam", context: "123456" },
        principal
      )
    ).rejects.toMatchObject({
      details: [
        expect.objectContaining({
          code: "COMMENT_REPORT_CONTEXT_TOO_LONG"
        })
      ]
    });
  });
});

async function createDependencies(
  overrides: Partial<CommentReportingConfig> = {}
) {
  const comments = new InMemoryCommentRepository();
  const reports = new InMemoryCommentReportRepository();
  const transactions = new InMemoryTransactionManager();
  const config: CommentReportingConfig = {
    maximumContextLength: 500,
    maximumResolutionNoteLength: 500,
    maximumReportsPerWindow: 5,
    rateLimitWindowSeconds: 600,
    queuePageSize: 50,
    ...overrides
  };
  const logger = createLogger();
  const clock: CommentReportClock = {
    now: () => new Date("2026-07-23T12:00:00.000Z")
  };
  const service = new CommentReportsService(
    comments,
    reports,
    transactions,
    new DefaultCommentReportPolicy(config),
    config,
    clock,
    logger
  );
  const seeded = await comments.create({
    matchId: "match-2026-001",
    author: {
      kind: "account",
      displayName: "Commenter",
      userId: "user-commenter"
    },
    body: "Reported comment."
  });
  if (!seeded.ok) {
    throw new Error("Unable to seed comment.");
  }

  return {
    comments,
    reports,
    logger,
    service,
    commentId: seeded.value.id
  };
}

function createLogger(): jest.Mocked<AppLogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn()
  };
}
