import { AuthenticatedPrincipal } from "../domain";
import { AppLogger } from "../logging";
import { RealtimeUpdatePublisher } from "../realtime";
import {
  InMemoryCommentReportRepository,
  InMemoryCommentRepository,
  InMemoryTransactionManager
} from "../repositories";
import { CommentReportingConfig } from "../config/comment-reporting.config";
import { AdminCommentReportsService } from "./admin-comment-reports.service";
import { CommentReportClock } from "./comment-report-clock";
import { DefaultCommentReportPolicy } from "./comment-report.policy";
import { CommentReportsService } from "./comment-reports.service";

describe("AdminCommentReportsService", () => {
  it("lists and marks an open report reviewed idempotently", async () => {
    const dependencies = await createDependencies();
    const submitted = await submitReport(dependencies);

    const queue = await dependencies.admin.list(undefined);
    expect(queue.map((item) => item.report.id)).toEqual([submitted.id]);

    const reviewed = await dependencies.admin.moderate(
      submitted.id,
      { action: "mark_reviewed" },
      "operator-1"
    );
    const repeated = await dependencies.admin.moderate(
      submitted.id,
      { action: "mark_reviewed" },
      "operator-1"
    );

    expect(reviewed).toMatchObject({
      status: "reviewed",
      moderatorId: "operator-1",
      reviewedAt: "2026-07-23T12:00:00.000Z"
    });
    expect(repeated).toEqual(reviewed);
  });

  it("dismisses a report without removing its comment", async () => {
    const dependencies = await createDependencies();
    const submitted = await submitReport(dependencies);

    const resolved = await dependencies.admin.moderate(
      submitted.id,
      { action: "dismiss", note: "No violation found." },
      "operator-1"
    );

    expect(resolved).toMatchObject({
      status: "resolved",
      resolution: "dismissed",
      resolutionNote: "No violation found."
    });
    const repeated = await dependencies.admin.moderate(
      submitted.id,
      { action: "remove_comment" },
      "operator-2"
    );
    expect(repeated).toEqual(resolved);
    await expectLiveComment(dependencies, true);
    expect(
      dependencies.realtime.publishCommentsUpdated
    ).not.toHaveBeenCalled();
  });

  it("removes the comment, resolves related reports, and publishes realtime once", async () => {
    const dependencies = await createDependencies();
    const first = await submitReport(dependencies);
    await submitReport(dependencies, {
      userId: "user-reporter-2",
      displayName: "Second Reporter",
      sessionId: "session-2"
    });

    const resolved = await dependencies.admin.moderate(
      first.id,
      { action: "remove_comment", note: "Confirmed harassment." },
      "operator-1"
    );

    expect(resolved).toMatchObject({
      status: "resolved",
      resolution: "comment_removed"
    });
    await expectLiveComment(dependencies, false);
    const resolvedQueue = await dependencies.admin.list("resolved");
    expect(resolvedQueue).toHaveLength(2);
    expect(
      resolvedQueue.every(
        (item) => item.report.resolution === "comment_removed"
      )
    ).toBe(true);
    expect(
      dependencies.realtime.publishCommentsUpdated
    ).toHaveBeenCalledWith({
      matchId: "match-2026-001",
      metadata: {
        commentId: dependencies.commentId,
        moderationAction: "removed"
      }
    });
  });

  it("validates queue status, actions, and note length", async () => {
    const dependencies = await createDependencies({
      maximumResolutionNoteLength: 5
    });
    const submitted = await submitReport(dependencies);

    await expect(dependencies.admin.list("unknown")).rejects.toMatchObject({
      details: [
        expect.objectContaining({
          code: "COMMENT_REPORT_STATUS_INVALID"
        })
      ]
    });
    await expect(
      dependencies.admin.moderate(
        submitted.id,
        { action: "unknown" },
        "operator-1"
      )
    ).rejects.toMatchObject({
      details: [
        expect.objectContaining({
          code: "COMMENT_REPORT_ACTION_INVALID"
        })
      ]
    });
    await expect(
      dependencies.admin.moderate(
        submitted.id,
        { action: "dismiss", note: "123456" },
        "operator-1"
      )
    ).rejects.toMatchObject({
      details: [
        expect.objectContaining({
          code: "COMMENT_REPORT_NOTE_TOO_LONG"
        })
      ]
    });
  });

  it("returns a stable not-found error", async () => {
    const dependencies = await createDependencies();

    await expect(
      dependencies.admin.moderate(
        "missing-report",
        { action: "dismiss" },
        "operator-1"
      )
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      details: [
        expect.objectContaining({ code: "COMMENT_REPORT_NOT_FOUND" })
      ]
    });
  });
});

interface Dependencies {
  comments: InMemoryCommentRepository;
  reports: InMemoryCommentReportRepository;
  publicReports: CommentReportsService;
  admin: AdminCommentReportsService;
  realtime: jest.Mocked<RealtimeUpdatePublisher>;
  commentId: string;
}

async function createDependencies(
  overrides: Partial<CommentReportingConfig> = {}
): Promise<Dependencies> {
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
  const clock: CommentReportClock = {
    now: () => new Date("2026-07-23T12:00:00.000Z")
  };
  const logger = createLogger();
  const realtime = {
    publishCommentsUpdated: jest.fn()
  } as unknown as jest.Mocked<RealtimeUpdatePublisher>;
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
    publicReports: new CommentReportsService(
      comments,
      reports,
      transactions,
      new DefaultCommentReportPolicy(config),
      config,
      clock,
      logger
    ),
    admin: new AdminCommentReportsService(
      comments,
      reports,
      transactions,
      config,
      clock,
      realtime,
      logger
    ),
    realtime,
    commentId: seeded.value.id
  };
}

async function submitReport(
  dependencies: Dependencies,
  overrides: Partial<AuthenticatedPrincipal> = {}
) {
  return dependencies.publicReports.submit(
    dependencies.commentId,
    { reason: "harassment" },
    {
      userId: "user-reporter",
      displayName: "Reporter",
      provider: "local_account",
      sessionId: "session-1",
      expiresAt: "2026-08-01T00:00:00.000Z",
      ...overrides
    }
  );
}

async function expectLiveComment(
  dependencies: Dependencies,
  expected: boolean
): Promise<void> {
  const result = await dependencies.comments.findById(
    dependencies.commentId
  );
  expect(result.ok && result.value !== null).toBe(expected);
}

function createLogger(): jest.Mocked<AppLogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn()
  };
}
