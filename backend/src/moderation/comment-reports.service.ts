import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { AuthenticatedPrincipal, CommentReport } from "../domain";
import {
  COMMENT_REPOSITORY,
  COMMENT_REPORT_REPOSITORY,
  CommentReportRepository,
  CommentRepository,
  TRANSACTION_MANAGER,
  TransactionManager
} from "../repositories";
import {
  COMMENT_REPORTING_CONFIG,
  CommentReportingConfig
} from "../config/comment-reporting.config";
import { APP_LOGGER, AppLogger } from "../logging";
import { unwrapRepositoryResult } from "../public-api/repository-result.mapper";
import {
  COMMENT_REPORT_CLOCK,
  CommentReportClock
} from "./comment-report-clock";
import {
  COMMENT_REPORT_POLICY,
  CommentReportPolicy,
  CommentReportPolicyDecision,
  SubmitCommentReportRequest
} from "./comment-report.policy";
import {
  commentReportRateLimitedError,
  commentUnavailableError,
  invalidCommentReportError
} from "./comment-report.errors";

export interface CommentReportReceipt {
  id: string;
  status: CommentReport["status"];
  submittedAt: string;
  alreadyReported: boolean;
}

@Injectable()
export class CommentReportsService {
  constructor(
    @Inject(COMMENT_REPOSITORY)
    private readonly comments: CommentRepository,
    @Inject(COMMENT_REPORT_REPOSITORY)
    private readonly reports: CommentReportRepository,
    @Inject(TRANSACTION_MANAGER)
    private readonly transactions: TransactionManager,
    @Inject(COMMENT_REPORT_POLICY)
    private readonly policy: CommentReportPolicy,
    @Inject(COMMENT_REPORTING_CONFIG)
    private readonly config: CommentReportingConfig,
    @Inject(COMMENT_REPORT_CLOCK)
    private readonly clock: CommentReportClock,
    @Inject(APP_LOGGER)
    private readonly logger: AppLogger
  ) {}

  async submit(
    commentId: string,
    request: SubmitCommentReportRequest | null | undefined,
    principal: AuthenticatedPrincipal
  ): Promise<CommentReportReceipt> {
    const decision = this.policy.evaluate(request);
    if (decision.status === "rejected") {
      this.logRejected(commentId, decision);
      throw invalidCommentReportError(decision.reason, this.config);
    }

    const now = this.clock.now();
    const result = await this.transactions.runInTransaction(
      async (transaction) => {
        const comment = unwrapRepositoryResult(
          await this.comments.findByIdForUpdate(commentId, transaction),
          "Unable to verify the reported comment."
        );
        if (comment === null) {
          throw commentUnavailableError(commentId);
        }

        return unwrapRepositoryResult(
          await this.reports.submit(
            {
              id: `report-${randomUUID()}`,
              commentId,
              matchId: comment.matchId,
              reporterUserId: principal.userId,
              reason: decision.reason,
              context: decision.context,
              createdAt: now.toISOString()
            },
            {
              earliestCreatedAt: new Date(
                now.getTime() -
                  this.config.rateLimitWindowSeconds * 1_000
              ).toISOString(),
              now: now.toISOString(),
              maximumReports: this.config.maximumReportsPerWindow,
              windowSeconds: this.config.rateLimitWindowSeconds
            },
            transaction
          ),
          "Unable to submit the comment report."
        );
      }
    );

    if (result.status === "rate_limited") {
      this.logRejected(commentId, {
        status: "rejected",
        reason: "rate_limited",
        contextCharacterCount: Array.from(decision.context ?? "").length
      });
      throw commentReportRateLimitedError(result.retryAfterSeconds);
    }

    this.logger.info("Comment report accepted.", {
      component: CommentReportsService.name,
      operation: "submit",
      matchId: result.report.matchId,
      metadata: {
        reportId: result.report.id,
        commentId,
        reason: decision.reason,
        decision: result.status
      }
    });
    return {
      id: result.report.id,
      status: result.report.status,
      submittedAt: result.report.createdAt,
      alreadyReported: result.status === "existing"
    };
  }

  private logRejected(
    commentId: string,
    decision:
      | Extract<CommentReportPolicyDecision, { status: "rejected" }>
      | {
          status: "rejected";
          reason: "rate_limited";
          contextCharacterCount: number;
        }
  ): void {
    this.logger.warning("Comment report rejected.", {
      component: CommentReportsService.name,
      operation: "submit",
      metadata: {
        commentId,
        reason: decision.reason,
        contextCharacterCount: decision.contextCharacterCount
      }
    });
  }
}
