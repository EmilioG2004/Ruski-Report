import { resolve } from "node:path";

export const COMMENTS_CONFIG = Symbol("COMMENTS_CONFIG");

export interface CommentsConfig {
  maximumBodyLength: number;
  duplicateWindowSeconds: number;
  maximumLinks: number;
  maximumRepeatedCharacterRun: number;
  maximumRepeatedTokenCount: number;
  moderationRulesPath: string;
}

export function loadCommentsConfig(
  environment: NodeJS.ProcessEnv = process.env
): CommentsConfig {
  return {
    maximumBodyLength: positiveInteger(
      environment.COMMENT_MAX_BODY_LENGTH,
      500,
      "COMMENT_MAX_BODY_LENGTH"
    ),
    duplicateWindowSeconds: positiveInteger(
      environment.COMMENT_DUPLICATE_WINDOW_SECONDS,
      300,
      "COMMENT_DUPLICATE_WINDOW_SECONDS"
    ),
    maximumLinks: nonnegativeInteger(
      environment.COMMENT_MAX_LINKS,
      2,
      "COMMENT_MAX_LINKS"
    ),
    maximumRepeatedCharacterRun: positiveInteger(
      environment.COMMENT_MAX_REPEATED_CHARACTER_RUN,
      8,
      "COMMENT_MAX_REPEATED_CHARACTER_RUN"
    ),
    maximumRepeatedTokenCount: positiveInteger(
      environment.COMMENT_MAX_REPEATED_TOKEN_COUNT,
      4,
      "COMMENT_MAX_REPEATED_TOKEN_COUNT"
    ),
    moderationRulesPath:
      environment.COMMENT_MODERATION_RULES_PATH?.trim() ||
      resolve(__dirname, "../../config/comment-moderation-rules.json")
  };
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  const parsed = nonnegativeInteger(value, fallback, name);

  if (parsed === 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function nonnegativeInteger(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a nonnegative integer.`);
  }

  return parsed;
}
