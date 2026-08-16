import { loadCommentReportingConfig } from "./comment-reporting.config";

describe("loadCommentReportingConfig", () => {
  it("loads safe reporting defaults", () => {
    expect(loadCommentReportingConfig({})).toEqual({
      maximumContextLength: 500,
      maximumResolutionNoteLength: 500,
      maximumReportsPerWindow: 5,
      rateLimitWindowSeconds: 600,
      queuePageSize: 50
    });
  });

  it("loads environment overrides", () => {
    expect(
      loadCommentReportingConfig({
        COMMENT_REPORT_CONTEXT_MAX_LENGTH: "800",
        COMMENT_REPORT_RESOLUTION_NOTE_MAX_LENGTH: "600",
        COMMENT_REPORT_MAX_PER_WINDOW: "7",
        COMMENT_REPORT_WINDOW_SECONDS: "900",
        COMMENT_REPORT_QUEUE_PAGE_SIZE: "25"
      })
    ).toEqual({
      maximumContextLength: 800,
      maximumResolutionNoteLength: 600,
      maximumReportsPerWindow: 7,
      rateLimitWindowSeconds: 900,
      queuePageSize: 25
    });
  });

  it.each(["0", "-1", "1.5", "invalid"])(
    "rejects invalid positive integers: %s",
    (value) => {
      expect(() =>
        loadCommentReportingConfig({
          COMMENT_REPORT_MAX_PER_WINDOW: value
        })
      ).toThrow("COMMENT_REPORT_MAX_PER_WINDOW");
    }
  );

  it("rejects a context limit beyond the database constraint", () => {
    expect(() =>
      loadCommentReportingConfig({
        COMMENT_REPORT_CONTEXT_MAX_LENGTH: "2001"
      })
    ).toThrow("cannot exceed 2000");
  });
});
