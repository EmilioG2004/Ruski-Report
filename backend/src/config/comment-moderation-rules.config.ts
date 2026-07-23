import { readFileSync } from "node:fs";

export const COMMENT_MODERATION_RULES = Symbol("COMMENT_MODERATION_RULES");

export interface CommentModerationRules {
  blockedPhrases: readonly string[];
}

interface UnvalidatedCommentModerationRules {
  blockedPhrases?: unknown;
}

export function loadCommentModerationRules(
  path: string
): CommentModerationRules {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Unable to load comment moderation rules from "${path}".`, {
      cause: error
    });
  }

  if (!isRulesObject(parsed) || parsed.blockedPhrases.length === 0) {
    throw new Error(
      "Comment moderation rules must contain at least one blocked phrase."
    );
  }

  const blockedPhrases = parsed.blockedPhrases.map((value, index) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(
        `Comment moderation rule at blockedPhrases[${index}] must be a nonempty string.`
      );
    }

    return value.trim();
  });

  return { blockedPhrases };
}

function isRulesObject(
  value: unknown
): value is Required<UnvalidatedCommentModerationRules> & {
  blockedPhrases: unknown[];
} {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as UnvalidatedCommentModerationRules).blockedPhrases)
  );
}
