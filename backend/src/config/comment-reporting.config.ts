export const COMMENT_REPORTING_CONFIG = Symbol("COMMENT_REPORTING_CONFIG");

const DATABASE_CONTEXT_LIMIT = 2_000;

export interface CommentReportingConfig {
  maximumContextLength: number;
  maximumResolutionNoteLength: number;
  maximumReportsPerWindow: number;
  rateLimitWindowSeconds: number;
  queuePageSize: number;
}

export function loadCommentReportingConfig(
  environment: NodeJS.ProcessEnv = process.env
): CommentReportingConfig {
  const config = {
    maximumContextLength: positiveInteger(
      environment.COMMENT_REPORT_CONTEXT_MAX_LENGTH,
      500,
      "COMMENT_REPORT_CONTEXT_MAX_LENGTH"
    ),
    maximumResolutionNoteLength: positiveInteger(
      environment.COMMENT_REPORT_RESOLUTION_NOTE_MAX_LENGTH,
      500,
      "COMMENT_REPORT_RESOLUTION_NOTE_MAX_LENGTH"
    ),
    maximumReportsPerWindow: positiveInteger(
      environment.COMMENT_REPORT_MAX_PER_WINDOW,
      5,
      "COMMENT_REPORT_MAX_PER_WINDOW"
    ),
    rateLimitWindowSeconds: positiveInteger(
      environment.COMMENT_REPORT_WINDOW_SECONDS,
      600,
      "COMMENT_REPORT_WINDOW_SECONDS"
    ),
    queuePageSize: positiveInteger(
      environment.COMMENT_REPORT_QUEUE_PAGE_SIZE,
      50,
      "COMMENT_REPORT_QUEUE_PAGE_SIZE"
    )
  };

  if (
    config.maximumContextLength > DATABASE_CONTEXT_LIMIT ||
    config.maximumResolutionNoteLength > DATABASE_CONTEXT_LIMIT
  ) {
    throw new Error(
      `Comment reporting text limits cannot exceed ${DATABASE_CONTEXT_LIMIT}.`
    );
  }

  return config;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}
