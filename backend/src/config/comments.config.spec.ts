import { loadCommentsConfig } from "./comments.config";

describe("comments config", () => {
  it("provides moderation and spam-prevention defaults", () => {
    const config = loadCommentsConfig({});

    expect(config).toMatchObject({
      maximumBodyLength: 500,
      duplicateWindowSeconds: 300,
      maximumLinks: 2,
      maximumRepeatedCharacterRun: 8,
      maximumRepeatedTokenCount: 4
    });
    expect(config.moderationRulesPath).toMatch(
      /config\/comment-moderation-rules\.json$/
    );
  });

  it("reads deploy-time overrides", () => {
    const config = loadCommentsConfig({
      COMMENT_MAX_BODY_LENGTH: "280",
      COMMENT_DUPLICATE_WINDOW_SECONDS: "120",
      COMMENT_MAX_LINKS: "1",
      COMMENT_MAX_REPEATED_CHARACTER_RUN: "6",
      COMMENT_MAX_REPEATED_TOKEN_COUNT: "3",
      COMMENT_MODERATION_RULES_PATH: "/etc/ruski/moderation.json"
    });

    expect(config).toEqual({
      maximumBodyLength: 280,
      duplicateWindowSeconds: 120,
      maximumLinks: 1,
      maximumRepeatedCharacterRun: 6,
      maximumRepeatedTokenCount: 3,
      moderationRulesPath: "/etc/ruski/moderation.json"
    });
  });

  it("rejects invalid numeric values", () => {
    expect(() =>
      loadCommentsConfig({ COMMENT_DUPLICATE_WINDOW_SECONDS: "never" })
    ).toThrow(
      "COMMENT_DUPLICATE_WINDOW_SECONDS must be a nonnegative integer."
    );
    expect(() =>
      loadCommentsConfig({ COMMENT_MAX_BODY_LENGTH: "0" })
    ).toThrow("COMMENT_MAX_BODY_LENGTH must be a positive integer.");
  });
});
