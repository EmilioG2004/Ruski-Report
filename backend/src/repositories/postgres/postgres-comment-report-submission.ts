import {
  CommentReportRateLimit,
  SubmitCommentReportInput,
  SubmitCommentReportResult
} from "../comment-report-repository";
import { PostgresExecutor } from "./postgres-executor";
import {
  CommentReportRow,
  mapCommentReport
} from "./postgres-comment-report-row";

export async function submitCommentReport(
  executor: PostgresExecutor,
  input: SubmitCommentReportInput,
  rateLimit: CommentReportRateLimit
): Promise<SubmitCommentReportResult> {
  await executor.query(
    `
      SELECT pg_advisory_xact_lock(
        hashtextextended('comment-report:' || $1::text, 0)
      )
    `,
    [input.reporterUserId]
  );

  const existing = await executor.query<CommentReportRow>(
    `
      SELECT *
      FROM comment_reports
      WHERE reported_comment_id = $1 AND reporter_user_id = $2
    `,
    [input.commentId, input.reporterUserId]
  );
  if (existing.rows[0] !== undefined) {
    return {
      status: "existing",
      report: mapCommentReport(existing.rows[0])
    };
  }

  const recent = await executor.query<{
    report_count: string | number;
    oldest_created_at: Date | string | null;
  }>(
    `
      SELECT
        count(*) AS report_count,
        min(created_at) AS oldest_created_at
      FROM comment_reports
      WHERE reporter_user_id = $1
        AND created_at >= $2::timestamptz
    `,
    [input.reporterUserId, rateLimit.earliestCreatedAt]
  );
  const reportCount = Number(recent.rows[0]?.report_count ?? 0);
  const oldestCreatedAt = recent.rows[0]?.oldest_created_at ?? null;
  if (reportCount >= rateLimit.maximumReports && oldestCreatedAt !== null) {
    const retryAt =
      new Date(oldestCreatedAt).getTime() + rateLimit.windowSeconds * 1_000;
    return {
      status: "rate_limited",
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((retryAt - new Date(rateLimit.now).getTime()) / 1_000)
      )
    };
  }

  const created = await executor.query<CommentReportRow>(
    `
      INSERT INTO comment_reports (
        id,
        comment_id,
        reported_comment_id,
        match_id,
        reporter_user_id,
        reason,
        context,
        status,
        created_at,
        metadata
      ) VALUES ($1, $2, $2, $3, $4, $5, $6, 'open', $7, '{}')
      RETURNING *
    `,
    [
      input.id,
      input.commentId,
      input.matchId,
      input.reporterUserId,
      input.reason,
      input.context ?? null,
      input.createdAt
    ]
  );
  return {
    status: "created",
    report: mapCommentReport(created.rows[0])
  };
}
