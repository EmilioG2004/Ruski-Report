import { createHash } from "node:crypto";

export interface NormalizedCommentBody {
  value: string;
  comparisonValue: string;
  fingerprint: string;
  characterCount: number;
}

export class CommentBodyNormalizer {
  normalize(body: string | undefined): NormalizedCommentBody {
    const value = (body ?? "")
      .normalize("NFKC")
      .replace(/\r\n?/gu, "\n")
      .replace(/[^\S\n]+/gu, " ")
      .replace(/ *\n */gu, "\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim();

    const comparisonValue = this.comparisonValue(value);

    return {
      value,
      comparisonValue,
      fingerprint: createHash("sha256")
        .update(comparisonValue, "utf8")
        .digest("hex"),
      characterCount: Array.from(value).length
    };
  }

  comparisonValue(value: string): string {
    return value
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }
}
