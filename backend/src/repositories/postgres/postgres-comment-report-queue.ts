import { PostgresDatabase } from "../../database";
import {
  CommentReport,
  CommentReportQueueItem,
  CommentReportStatus
} from "../../domain";
import { PostgresExecutor } from "./postgres-executor";
import {
  CommentReportQueueRow,
  CommentReportRow,
  mapCommentReport,
  mapCommentReportQueueItem
} from "./postgres-comment-report-row";

export async function listCommentReports(
  database: PostgresDatabase,
  status: CommentReportStatus,
  limit: number
): Promise<CommentReportQueueItem[]> {
  const result = await database.query<CommentReportQueueRow>(
    `
      SELECT
        report.*,
        comment.author_display_name AS comment_author_display_name,
        comment.body AS comment_body,
        comment.created_at AS comment_created_at,
        comment.deleted_at AS comment_removed_at
      FROM comment_reports report
      LEFT JOIN comments comment ON comment.id = report.comment_id
      WHERE report.status = $1
      ORDER BY report.created_at, report.id
      LIMIT $2
    `,
    [status, limit]
  );
  return result.rows.map(mapCommentReportQueueItem);
}

export async function lockCommentReport(
  executor: PostgresExecutor,
  reportId: string
): Promise<CommentReport | null> {
  const reference = await executor.query<{
    reported_comment_id: string;
  }>(
    `
      SELECT reported_comment_id
      FROM comment_reports
      WHERE id = $1
    `,
    [reportId]
  );
  const reportedCommentId = reference.rows[0]?.reported_comment_id;
  if (reportedCommentId === undefined) {
    return null;
  }

  await executor.query(
    `
      SELECT pg_advisory_xact_lock(
        hashtextextended('comment-moderation:' || $1::text, 0)
      )
    `,
    [reportedCommentId]
  );
  const result = await executor.query<CommentReportRow>(
    `
      SELECT *
      FROM comment_reports
      WHERE id = $1
      FOR UPDATE
    `,
    [reportId]
  );
  const row = result.rows[0];
  return row === undefined ? null : mapCommentReport(row);
}
