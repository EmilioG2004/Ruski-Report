import { Injectable } from "@nestjs/common";

import { PostgresDatabase } from "../../database";
import {
  CommentReport,
  CommentReportQueueItem,
  CommentReportStatus
} from "../../domain";
import {
  CommentReportRateLimit,
  CommentReportRepository,
  ResolveCommentReportInput,
  ResolveCommentReportResult,
  ReviewCommentReportResult,
  SubmitCommentReportInput,
  SubmitCommentReportResult
} from "../comment-report-repository";
import {
  repositoryFailure,
  RepositoryResult,
  repositorySuccess
} from "../repository-result";
import { TransactionContext } from "../transaction";
import {
  markCommentReportReviewed,
  resolveCommentReport
} from "./postgres-comment-report-moderation";
import {
  listCommentReports,
  lockCommentReport
} from "./postgres-comment-report-queue";
import { submitCommentReport } from "./postgres-comment-report-submission";
import { selectPostgresExecutor } from "./postgres-executor";
import { mapPostgresError } from "./postgres-repository-error";

@Injectable()
export class PostgresCommentReportRepository
  implements CommentReportRepository
{
  constructor(private readonly database: PostgresDatabase) {}

  async submit(
    input: SubmitCommentReportInput,
    rateLimit: CommentReportRateLimit,
    transaction: TransactionContext
  ): Promise<RepositoryResult<SubmitCommentReportResult>> {
    return this.capture("Failed to submit comment report.", async () =>
      submitCommentReport(
        selectPostgresExecutor(this.database, transaction),
        input,
        rateLimit
      )
    );
  }

  async list(
    status: CommentReportStatus,
    limit: number
  ): Promise<RepositoryResult<CommentReportQueueItem[]>> {
    return this.capture("Failed to list comment reports.", () =>
      listCommentReports(this.database, status, limit)
    );
  }

  async findByIdForUpdate(
    reportId: string,
    transaction: TransactionContext
  ): Promise<RepositoryResult<CommentReport | null>> {
    return this.capture("Failed to lock comment report.", () =>
      lockCommentReport(
        selectPostgresExecutor(this.database, transaction),
        reportId
      )
    );
  }

  async markReviewed(
    reportId: string,
    moderatorId: string,
    reviewedAt: string,
    transaction: TransactionContext
  ): Promise<RepositoryResult<ReviewCommentReportResult>> {
    return this.capture("Failed to mark comment report reviewed.", () =>
      markCommentReportReviewed(
        selectPostgresExecutor(this.database, transaction),
        reportId,
        moderatorId,
        reviewedAt
      )
    );
  }

  async resolve(
    input: ResolveCommentReportInput,
    transaction: TransactionContext
  ): Promise<RepositoryResult<ResolveCommentReportResult>> {
    return this.capture("Failed to resolve comment report.", () =>
      resolveCommentReport(
        selectPostgresExecutor(this.database, transaction),
        input
      )
    );
  }

  private async capture<T>(
    message: string,
    operation: () => Promise<T>
  ): Promise<RepositoryResult<T>> {
    try {
      return repositorySuccess(await operation());
    } catch (error) {
      return repositoryFailure(mapPostgresError(error, message));
    }
  }
}
