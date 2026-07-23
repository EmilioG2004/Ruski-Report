import {
  CommentId,
  CommentReportId,
  ISODateTimeString,
  MatchId,
  Metadata,
  UserId
} from "./common";

export const COMMENT_REPORT_REASONS = [
  "harassment",
  "hate_or_discrimination",
  "threat_or_self_harm",
  "sexual_content",
  "spam",
  "other"
] as const;

export type CommentReportReason = (typeof COMMENT_REPORT_REASONS)[number];
export type CommentReportStatus = "open" | "reviewed" | "resolved";
export type CommentReportResolution = "dismissed" | "comment_removed";

export interface CommentReport {
  id: CommentReportId;
  commentId?: CommentId;
  reportedCommentId: CommentId;
  matchId: MatchId;
  reporterUserId?: UserId;
  reason: CommentReportReason;
  context?: string;
  status: CommentReportStatus;
  createdAt: ISODateTimeString;
  reviewedAt?: ISODateTimeString;
  resolvedAt?: ISODateTimeString;
  resolution?: CommentReportResolution;
  moderatorId?: string;
  resolutionNote?: string;
  metadata?: Metadata;
}

export interface CommentReportQueueItem {
  report: CommentReport;
  comment?: {
    authorDisplayName: string;
    body: string;
    createdAt: ISODateTimeString;
    removedAt?: ISODateTimeString;
  };
}
