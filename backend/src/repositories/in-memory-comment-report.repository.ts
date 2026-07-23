import {
  CommentReport,
  CommentReportQueueItem,
  CommentReportStatus
} from "../domain";
import {
  CommentReportRepository,
  CommentReportRateLimit,
  ResolveCommentReportInput,
  ResolveCommentReportResult,
  ReviewCommentReportResult,
  SubmitCommentReportInput,
  SubmitCommentReportResult
} from "./comment-report-repository";
import {
  repositorySuccess,
  RepositoryResult
} from "./repository-result";
import { TransactionContext } from "./transaction";

export class InMemoryCommentReportRepository
  implements CommentReportRepository
{
  private reports: CommentReport[] = [];

  async submit(
    input: SubmitCommentReportInput,
    rateLimit: CommentReportRateLimit,
    _transaction: TransactionContext
  ): Promise<RepositoryResult<SubmitCommentReportResult>> {
    const existing = this.reports.find(
      (report) =>
        report.reportedCommentId === input.commentId &&
        report.reporterUserId === input.reporterUserId
    );
    if (existing !== undefined) {
      return repositorySuccess({
        status: "existing",
        report: clone(existing)
      });
    }

    const recent = this.reports
      .filter(
        (report) =>
          report.reporterUserId === input.reporterUserId &&
          report.createdAt >= rateLimit.earliestCreatedAt
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    if (recent.length >= rateLimit.maximumReports) {
      const retryAt =
        Date.parse(recent[0].createdAt) + rateLimit.windowSeconds * 1_000;
      return repositorySuccess({
        status: "rate_limited",
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((retryAt - Date.parse(rateLimit.now)) / 1_000)
        )
      });
    }

    const report: CommentReport = {
      id: input.id,
      commentId: input.commentId,
      reportedCommentId: input.commentId,
      matchId: input.matchId,
      reporterUserId: input.reporterUserId,
      reason: input.reason,
      context: input.context,
      status: "open",
      createdAt: input.createdAt
    };
    this.reports = [...this.reports, report];
    return repositorySuccess({ status: "created", report: clone(report) });
  }

  async list(
    status: CommentReportStatus,
    limit: number
  ): Promise<RepositoryResult<CommentReportQueueItem[]>> {
    return repositorySuccess(
      this.reports
        .filter((report) => report.status === status)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, limit)
        .map((report) => ({ report: clone(report) }))
    );
  }

  async findByIdForUpdate(
    reportId: string,
    _transaction: TransactionContext
  ): Promise<RepositoryResult<CommentReport | null>> {
    const report = this.reports.find((candidate) => candidate.id === reportId);
    return repositorySuccess(report === undefined ? null : clone(report));
  }

  async markReviewed(
    reportId: string,
    moderatorId: string,
    reviewedAt: string,
    _transaction: TransactionContext
  ): Promise<RepositoryResult<ReviewCommentReportResult>> {
    const report = this.reports.find((candidate) => candidate.id === reportId);
    if (report === undefined) {
      return repositorySuccess({ status: "not_found" });
    }
    if (report.status === "resolved") {
      return repositorySuccess({
        status: "already_resolved",
        report: clone(report)
      });
    }
    if (report.status === "reviewed") {
      return repositorySuccess({
        status: "already_reviewed",
        report: clone(report)
      });
    }

    const reviewed: CommentReport = {
      ...report,
      status: "reviewed",
      reviewedAt,
      moderatorId
    };
    this.replace(reviewed);
    return repositorySuccess({ status: "reviewed", report: clone(reviewed) });
  }

  async resolve(
    input: ResolveCommentReportInput,
    _transaction: TransactionContext
  ): Promise<RepositoryResult<ResolveCommentReportResult>> {
    const selected = this.reports.find(
      (candidate) => candidate.id === input.reportId
    );
    if (selected === undefined) {
      return repositorySuccess({ status: "not_found" });
    }
    if (selected.status === "resolved") {
      return repositorySuccess({
        status: "already_resolved",
        report: clone(selected)
      });
    }

    const targets = input.resolveAllForComment
      ? this.reports.filter(
          (report) =>
            report.reportedCommentId === input.reportedCommentId &&
            report.status !== "resolved"
        )
      : [selected];
    for (const report of targets) {
      this.replace({
        ...report,
        status: "resolved",
        reviewedAt: report.reviewedAt ?? input.resolvedAt,
        resolvedAt: input.resolvedAt,
        resolution: input.resolution,
        moderatorId: input.moderatorId,
        resolutionNote: input.resolutionNote
      });
    }

    const resolved = this.reports.find(
      (candidate) => candidate.id === input.reportId
    )!;
    return repositorySuccess({
      status: "resolved",
      report: clone(resolved)
    });
  }

  private replace(report: CommentReport): void {
    this.reports = this.reports.map((candidate) =>
      candidate.id === report.id ? report : candidate
    );
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
