import {
  ResolveCommentReportInput,
  ResolveCommentReportResult,
  ReviewCommentReportResult
} from "../comment-report-repository";
import { PostgresExecutor } from "./postgres-executor";
import {
  CommentReportRow,
  mapCommentReport
} from "./postgres-comment-report-row";

export async function markCommentReportReviewed(
  executor: PostgresExecutor,
  reportId: string,
  moderatorId: string,
  reviewedAt: string
): Promise<ReviewCommentReportResult> {
  const updated = await executor.query<CommentReportRow>(
    `
      UPDATE comment_reports
      SET
        status = 'reviewed',
        reviewed_at = $2,
        moderator_id = $3
      WHERE id = $1 AND status = 'open'
      RETURNING *
    `,
    [reportId, reviewedAt, moderatorId]
  );
  if (updated.rows[0] !== undefined) {
    return {
      status: "reviewed",
      report: mapCommentReport(updated.rows[0])
    };
  }

  const current = await findCurrent(executor, reportId);
  if (current === null) {
    return { status: "not_found" };
  }
  return {
    status:
      current.status === "resolved"
        ? "already_resolved"
        : "already_reviewed",
    report: current
  };
}

export async function resolveCommentReport(
  executor: PostgresExecutor,
  input: ResolveCommentReportInput
): Promise<ResolveCommentReportResult> {
  const updated = await executor.query<CommentReportRow>(
    `
      UPDATE comment_reports
      SET
        status = 'resolved',
        reviewed_at = COALESCE(reviewed_at, $3::timestamptz),
        resolved_at = $3,
        resolution = $4,
        moderator_id = $5,
        resolution_note = $6
      WHERE status <> 'resolved'
        AND (
          id = $1
          OR ($7::boolean AND reported_comment_id = $2)
        )
      RETURNING *
    `,
    [
      input.reportId,
      input.reportedCommentId,
      input.resolvedAt,
      input.resolution,
      input.moderatorId,
      input.resolutionNote ?? null,
      input.resolveAllForComment
    ]
  );
  const selected = updated.rows.find((row) => row.id === input.reportId);
  if (selected !== undefined) {
    return {
      status: "resolved",
      report: mapCommentReport(selected)
    };
  }

  const current = await findCurrent(executor, input.reportId);
  return current === null
    ? { status: "not_found" }
    : { status: "already_resolved", report: current };
}

async function findCurrent(
  executor: PostgresExecutor,
  reportId: string
) {
  const result = await executor.query<CommentReportRow>(
    "SELECT * FROM comment_reports WHERE id = $1",
    [reportId]
  );
  const row = result.rows[0];
  return row === undefined ? null : mapCommentReport(row);
}
