import { HttpStatus, Inject, Injectable } from "@nestjs/common";

import {
  CommentReport,
  CommentReportQueueItem,
  CommentReportResolution
} from "../domain";
import {
  COMMENT_REPOSITORY,
  COMMENT_REPORT_REPOSITORY,
  CommentReportRepository,
  CommentRepository,
  TRANSACTION_MANAGER,
  TransactionManager
} from "../repositories";
import { AppError } from "../errors";
import { APP_LOGGER, AppLogger } from "../logging";
import { RealtimeUpdatePublisher } from "../realtime";
import {
  COMMENT_REPORTING_CONFIG,
  CommentReportingConfig
} from "../config/comment-reporting.config";
import {
  COMMENT_REPORT_CLOCK,
  CommentReportClock
} from "./comment-report-clock";
import { unwrapRepositoryResult } from "../public-api/repository-result.mapper";
import {
  ModerateCommentReportRequest,
  normalizeResolutionNote,
  parseCommentReportAction,
  parseCommentReportStatus
} from "./comment-report-moderation.request";

@Injectable()
export class AdminCommentReportsService {
  constructor(
    @Inject(COMMENT_REPOSITORY)
    private readonly comments: CommentRepository,
    @Inject(COMMENT_REPORT_REPOSITORY)
    private readonly reports: CommentReportRepository,
    @Inject(TRANSACTION_MANAGER)
    private readonly transactions: TransactionManager,
    @Inject(COMMENT_REPORTING_CONFIG)
    private readonly config: CommentReportingConfig,
    @Inject(COMMENT_REPORT_CLOCK)
    private readonly clock: CommentReportClock,
    private readonly realtime: RealtimeUpdatePublisher,
    @Inject(APP_LOGGER)
    private readonly logger: AppLogger
  ) {}

  async list(statusValue: string | undefined): Promise<CommentReportQueueItem[]> {
    const status = parseCommentReportStatus(statusValue);
    return unwrapRepositoryResult(
      await this.reports.list(status, this.config.queuePageSize),
      "Unable to load comment reports."
    );
  }

  async moderate(
    reportId: string,
    request: ModerateCommentReportRequest | null | undefined,
    moderatorId: string
  ): Promise<CommentReport> {
    const action = parseCommentReportAction(request?.action);
    const note = normalizeResolutionNote(
      request?.note,
      this.config.maximumResolutionNoteLength
    );
    const occurredAt = this.clock.now().toISOString();

    const outcome = await this.transactions.runInTransaction(
      async (transaction) => {
        const report = unwrapRepositoryResult(
          await this.reports.findByIdForUpdate(reportId, transaction),
          "Unable to load the comment report."
        );
        if (report === null) {
          throw reportNotFoundError(reportId);
        }
        if (report.status === "resolved") {
          return {
            report,
            commentRemoved: false
          };
        }

        if (action === "mark_reviewed") {
          const reviewed = unwrapRepositoryResult(
            await this.reports.markReviewed(
              reportId,
              moderatorId,
              occurredAt,
              transaction
            ),
            "Unable to mark the comment report reviewed."
          );
          if (reviewed.status === "not_found") {
            throw reportNotFoundError(reportId);
          }
          return {
            report: reviewed.report,
            commentRemoved: false
          };
        }

        const resolution: CommentReportResolution =
          action === "dismiss" ? "dismissed" : "comment_removed";
        let commentRemoved = false;
        if (resolution === "comment_removed" && report.commentId !== undefined) {
          const deletion = await this.comments.delete(
            report.commentId,
            transaction
          );
          if (!deletion.ok && deletion.error.code !== "not_found") {
            unwrapRepositoryResult(
              deletion,
              "Unable to remove the reported comment."
            );
          }
          commentRemoved = deletion.ok;
        }

        const resolved = unwrapRepositoryResult(
          await this.reports.resolve(
            {
              reportId,
              reportedCommentId: report.reportedCommentId,
              resolution,
              moderatorId,
              resolutionNote: note,
              resolvedAt: occurredAt,
              resolveAllForComment: resolution === "comment_removed"
            },
            transaction
          ),
          "Unable to resolve the comment report."
        );
        if (resolved.status === "not_found") {
          throw reportNotFoundError(reportId);
        }
        return {
          report: resolved.report,
          commentRemoved
        };
      }
    );

    if (
      outcome.report.resolution === "comment_removed" &&
      outcome.commentRemoved
    ) {
      this.realtime.publishCommentsUpdated({
        matchId: outcome.report.matchId,
        metadata: {
          commentId: outcome.report.reportedCommentId,
          moderationAction: "removed"
        }
      });
    }
    this.logger.info("Comment report moderation action completed.", {
      component: AdminCommentReportsService.name,
      operation: "moderate",
      matchId: outcome.report.matchId,
      metadata: {
        reportId,
        commentId: outcome.report.reportedCommentId,
        moderatorId,
        action,
        status: outcome.report.status,
        resolution: outcome.report.resolution
      }
    });
    return outcome.report;
  }
}

function reportNotFoundError(reportId: string): AppError {
  return new AppError({
    code: "NOT_FOUND",
    message: "Comment report was not found.",
    statusCode: HttpStatus.NOT_FOUND,
    details: [
      {
        code: "COMMENT_REPORT_NOT_FOUND",
        message: "Comment report was not found.",
        path: "reportId",
        metadata: { reportId }
      }
    ]
  });
}
