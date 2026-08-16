import { AuthenticatedPrincipal, CommentReport } from "../domain";
import { AdminPrincipal } from "../admin";
import { AdminCommentReportsController } from "./admin-comment-reports.controller";
import { AdminCommentReportsService } from "./admin-comment-reports.service";
import { CommentReportsController } from "./comment-reports.controller";
import {
  CommentReportReceipt,
  CommentReportsService
} from "./comment-reports.service";

describe("comment reporting controllers", () => {
  it("delegates authenticated public report submissions", async () => {
    const receipt: CommentReportReceipt = {
      id: "report-1",
      status: "open",
      submittedAt: "2026-07-23T12:00:00.000Z",
      alreadyReported: false
    };
    const service = {
      submit: jest.fn().mockResolvedValue(receipt)
    } as unknown as CommentReportsService;
    const controller = new CommentReportsController(service);
    const principal = publicPrincipal();

    await expect(
      controller.submit(
        "comment-1",
        { reason: "harassment", context: "Please review." },
        principal
      )
    ).resolves.toBe(receipt);
    expect(service.submit).toHaveBeenCalledWith(
      "comment-1",
      { reason: "harassment", context: "Please review." },
      principal
    );
  });

  it("delegates operator queue and moderation actions", async () => {
    const report = sampleReport();
    const service = {
      list: jest.fn().mockResolvedValue([{ report }]),
      moderate: jest.fn().mockResolvedValue(report)
    } as unknown as AdminCommentReportsService;
    const controller = new AdminCommentReportsController(service);
    const principal: AdminPrincipal = { operatorId: "operator-1" };

    await expect(controller.list("open")).resolves.toEqual([{ report }]);
    await expect(
      controller.moderate(
        "report-1",
        { action: "dismiss", note: "No violation." },
        principal
      )
    ).resolves.toBe(report);
    expect(service.list).toHaveBeenCalledWith("open");
    expect(service.moderate).toHaveBeenCalledWith(
      "report-1",
      { action: "dismiss", note: "No violation." },
      "operator-1"
    );
  });
});

function publicPrincipal(): AuthenticatedPrincipal {
  return {
    userId: "user-1",
    displayName: "Reporter",
    provider: "local_account",
    sessionId: "session-1",
    expiresAt: "2026-08-01T00:00:00.000Z"
  };
}

function sampleReport(): CommentReport {
  return {
    id: "report-1",
    commentId: "comment-1",
    reportedCommentId: "comment-1",
    matchId: "match-1",
    reporterUserId: "user-1",
    reason: "harassment",
    status: "open",
    createdAt: "2026-07-23T12:00:00.000Z"
  };
}
