export const COMMENT_REPORT_CLOCK = Symbol("COMMENT_REPORT_CLOCK");

export interface CommentReportClock {
  now(): Date;
}

export class SystemCommentReportClock implements CommentReportClock {
  now(): Date {
    return new Date();
  }
}
