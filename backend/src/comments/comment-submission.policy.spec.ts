import { CommentsConfig } from "../config/comments.config";
import { CommentBodyNormalizer } from "./comment-body-normalizer";
import { ConfiguredCommentModerationPolicy } from "./configured-comment-moderation.policy";
import { DefaultCommentSubmissionPolicy } from "./comment-submission.policy";

const config: CommentsConfig = {
  maximumBodyLength: 40,
  duplicateWindowSeconds: 300,
  maximumLinks: 2,
  maximumRepeatedCharacterRun: 8,
  maximumRepeatedTokenCount: 4,
  moderationRulesPath: "unused-in-unit-tests.json"
};

describe("comment submission policy", () => {
  const normalizer = new CommentBodyNormalizer();
  const moderation = new ConfiguredCommentModerationPolicy(
    {
      blockedPhrases: ["kill yourself", "blocked phrase"]
    },
    normalizer
  );
  const policy = new DefaultCommentSubmissionPolicy(
    config,
    normalizer,
    moderation
  );

  it("normalizes Unicode, line endings, and excess whitespace", () => {
    expect(normalizer.normalize("  Ｇｒｅａｔ\tmatch.\r\n\r\n\r\nNice!  ")).toEqual({
      value: "Great match.\n\nNice!",
      comparisonValue: "great match nice",
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      characterCount: 19
    });
  });

  it("allows ordinary normalized comments", () => {
    expect(policy.evaluate("  Great   finish. ")).toMatchObject({
      status: "accepted",
      body: {
        value: "Great finish.",
        comparisonValue: "great finish"
      }
    });
  });

  it("rejects empty and oversized bodies with stable reasons", () => {
    expect(policy.evaluate(" \n ")).toEqual({
      status: "rejected",
      reason: "body_required",
      bodyCharacterCount: 0
    });
    expect(policy.evaluate("a".repeat(41))).toEqual({
      status: "rejected",
      reason: "body_too_long",
      bodyCharacterCount: 41
    });
  });

  it("rejects configured phrases after case, punctuation, and width normalization", () => {
    expect(policy.evaluate("ＫＩＬＬ...ＹＯＵＲＳＥＬＦ")).toMatchObject({
      status: "rejected",
      reason: "content_not_allowed",
      ruleId: "blocked-phrase-1"
    });
  });

  it.each([
    ["link spam", "http://a.co http://b.co http://c.co"],
    ["character spam", "Nooooooooo"],
    ["token spam", "buy buy buy buy buy"]
  ])("rejects %s", (_name, body) => {
    expect(policy.evaluate(body)).toMatchObject({
      status: "rejected",
      reason: "spam_detected"
    });
  });
});
