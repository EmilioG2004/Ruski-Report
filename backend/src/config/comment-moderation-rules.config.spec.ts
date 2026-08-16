import {
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadCommentModerationRules } from "./comment-moderation-rules.config";

describe("comment moderation rules config", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "ruski-comment-rules-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("loads and trims blocked phrases", () => {
    const path = writeRules({
      blockedPhrases: ["  blocked phrase  ", "threat phrase"]
    });

    expect(loadCommentModerationRules(path)).toEqual({
      blockedPhrases: ["blocked phrase", "threat phrase"]
    });
  });

  it("fails closed when the rules are absent or invalid", () => {
    expect(() =>
      loadCommentModerationRules(join(directory, "missing.json"))
    ).toThrow("Unable to load comment moderation rules");

    const emptyPath = writeRules({ blockedPhrases: [] });
    expect(() => loadCommentModerationRules(emptyPath)).toThrow(
      "must contain at least one blocked phrase"
    );
  });

  function writeRules(value: unknown): string {
    const path = join(directory, "rules.json");
    writeFileSync(path, JSON.stringify(value), "utf8");
    return path;
  }
});
