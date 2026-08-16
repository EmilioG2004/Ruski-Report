import {
  CommentReport,
  CommentReportId,
  CommentReportQueueItem,
  CommentReportReason,
  CommentReportResolution,
  CommentReportStatus,
  ISODateTimeString,
  MatchId,
  UserId
} from "../domain";
import { RepositoryResult } from "./repository-result";
import { TransactionContext } from "./transaction";

export const COMMENT_REPORT_REPOSITORY = Symbol("COMMENT_REPORT_REPOSITORY");

export interface SubmitCommentReportInput {
  id: CommentReportId;
  commentId: string;
  matchId: MatchId;
  reporterUserId: UserId;
  reason: CommentReportReason;
  context?: string;
  createdAt: ISODateTimeString;
}

export interface CommentReportRateLimit {
  earliestCreatedAt: ISODateTimeString;
  now: ISODateTimeString;
  maximumReports: number;
  windowSeconds: number;
}

export type SubmitCommentReportResult =
  | {
      status: "created";
      report: CommentReport;
    }
  | {
      status: "existing";
      report: CommentReport;
    }
  | {
      status: "rate_limited";
      retryAfterSeconds: number;
    };

export type ReviewCommentReportResult =
  | {
      status: "reviewed";
      report: CommentReport;
    }
  | {
      status: "already_reviewed" | "already_resolved";
      report: CommentReport;
    }
  | {
      status: "not_found";
    };

export type ResolveCommentReportResult =
  | {
      status: "resolved";
      report: CommentReport;
    }
  | {
      status: "already_resolved";
      report: CommentReport;
    }
  | {
      status: "not_found";
    };

export interface ResolveCommentReportInput {
  reportId: CommentReportId;
  reportedCommentId: string;
  resolution: CommentReportResolution;
  moderatorId: string;
  resolutionNote?: string;
  resolvedAt: ISODateTimeString;
  resolveAllForComment: boolean;
}

export interface CommentReportRepository {
  submit(
    input: SubmitCommentReportInput,
    rateLimit: CommentReportRateLimit,
    transaction: TransactionContext
  ): Promise<RepositoryResult<SubmitCommentReportResult>>;

  list(
    status: CommentReportStatus,
    limit: number
  ): Promise<RepositoryResult<CommentReportQueueItem[]>>;

  findByIdForUpdate(
    reportId: CommentReportId,
    transaction: TransactionContext
  ): Promise<RepositoryResult<CommentReport | null>>;

  markReviewed(
    reportId: CommentReportId,
    moderatorId: string,
    reviewedAt: ISODateTimeString,
    transaction: TransactionContext
  ): Promise<RepositoryResult<ReviewCommentReportResult>>;

  resolve(
    input: ResolveCommentReportInput,
    transaction: TransactionContext
  ): Promise<RepositoryResult<ResolveCommentReportResult>>;
}
