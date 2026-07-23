import { CommentReportingConfig } from "../config/comment-reporting.config";
import { DefaultCommentReportPolicy } from "./comment-report.policy";

const config: CommentReportingConfig = {
  maximumContextLength: 20,
  maximumResolutionNoteLength: 20,
  maximumReportsPerWindow: 5,
  rateLimitWindowSeconds: 600,
  queuePageSize: 50
};

describe("DefaultCommentReportPolicy", () => {
  const policy = new DefaultCommentReportPolicy(config);

  it("accepts supported reasons and normalizes optional context", () => {
    expect(
      policy.evaluate({
        reason: "harassment",
        context: "  Ｒｅｐｅａｔｅｄ\tinsults.  "
      })
    ).toEqual({
      status: "accepted",
      reason: "harassment",
      context: "Repeated insults."
    });
  });

  it("rejects absent and unsupported reasons", () => {
    expect(policy.evaluate(undefined)).toMatchObject({
      status: "rejected",
      reason: "reason_required"
    });
    expect(policy.evaluate({ reason: "not-a-reason" })).toMatchObject({
      status: "rejected",
      reason: "reason_invalid"
    });
  });

  it("requires context for Other and enforces the configured maximum", () => {
    expect(policy.evaluate({ reason: "other", context: "  " })).toMatchObject({
      status: "rejected",
      reason: "context_required"
    });
    expect(
      policy.evaluate({
        reason: "spam",
        context: "x".repeat(21)
      })
    ).toMatchObject({
      status: "rejected",
      reason: "context_too_long",
      contextCharacterCount: 21
    });
  });
});
