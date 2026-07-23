import {
  CommentReport,
  CommentReportQueueItem,
  CommentReportReason,
  CommentReportResolution,
  CommentReportStatus
} from "../../domain";
import { readISOString, readOptionalJson } from "./postgres-values";

export interface CommentReportRow {
  id: string;
  comment_id: string | null;
  reported_comment_id: string;
  match_id: string;
  reporter_user_id: string | null;
  reason: CommentReportReason;
  context: string | null;
  status: CommentReportStatus;
  created_at: Date | string;
  reviewed_at: Date | string | null;
  resolved_at: Date | string | null;
  resolution: CommentReportResolution | null;
  moderator_id: string | null;
  resolution_note: string | null;
  metadata: unknown;
}

export interface CommentReportQueueRow extends CommentReportRow {
  comment_author_display_name: string | null;
  comment_body: string | null;
  comment_created_at: Date | string | null;
  comment_removed_at: Date | string | null;
}

export function mapCommentReport(row: CommentReportRow): CommentReport {
  return {
    id: row.id,
    commentId: row.comment_id ?? undefined,
    reportedCommentId: row.reported_comment_id,
    matchId: row.match_id,
    reporterUserId: row.reporter_user_id ?? undefined,
    reason: row.reason,
    context: row.context ?? undefined,
    status: row.status,
    createdAt: readISOString(row.created_at),
    reviewedAt:
      row.reviewed_at === null
        ? undefined
        : readISOString(row.reviewed_at),
    resolvedAt:
      row.resolved_at === null
        ? undefined
        : readISOString(row.resolved_at),
    resolution: row.resolution ?? undefined,
    moderatorId: row.moderator_id ?? undefined,
    resolutionNote: row.resolution_note ?? undefined,
    metadata: readOptionalJson(row.metadata)
  };
}

export function mapCommentReportQueueItem(
  row: CommentReportQueueRow
): CommentReportQueueItem {
  const comment =
    row.comment_body === null ||
    row.comment_author_display_name === null ||
    row.comment_created_at === null
      ? undefined
      : {
          authorDisplayName: row.comment_author_display_name,
          body: row.comment_body,
          createdAt: readISOString(row.comment_created_at),
          removedAt:
            row.comment_removed_at === null
              ? undefined
              : readISOString(row.comment_removed_at)
        };
  return {
    report: mapCommentReport(row),
    comment
  };
}
