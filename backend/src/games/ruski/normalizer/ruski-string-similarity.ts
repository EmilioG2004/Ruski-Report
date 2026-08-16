export function tokenCoverage(
  alias: string,
  playerNames: readonly string[]
): number {
  const aliasTokens = tokenize(alias);
  const playerTokens = playerNames.flatMap(tokenize);

  if (aliasTokens.length === 0) {
    return 0;
  }

  return aliasTokens.filter((aliasToken) =>
    playerTokens.some((playerToken) =>
      aliasToken === playerToken ||
      (Math.min(aliasToken.length, playerToken.length) >= 4 &&
        (aliasToken.startsWith(playerToken) || playerToken.startsWith(aliasToken)))
    )
  ).length / aliasTokens.length;
}

export function stringSimilarity(first: string, second: string): number {
  const normalizedFirst = compact(first);
  const normalizedSecond = compact(second);

  if (normalizedFirst === normalizedSecond) {
    return 1;
  }

  if (normalizedFirst.length < 2 || normalizedSecond.length < 2) {
    return 0;
  }

  const firstBigrams = new Map<string, number>();
  for (let index = 0; index < normalizedFirst.length - 1; index += 1) {
    const bigram = normalizedFirst.slice(index, index + 2);
    firstBigrams.set(bigram, (firstBigrams.get(bigram) ?? 0) + 1);
  }

  let matches = 0;
  for (let index = 0; index < normalizedSecond.length - 1; index += 1) {
    const bigram = normalizedSecond.slice(index, index + 2);
    const count = firstBigrams.get(bigram) ?? 0;
    if (count > 0) {
      matches += 1;
      firstBigrams.set(bigram, count - 1);
    }
  }

  return (2 * matches) /
    (normalizedFirst.length + normalizedSecond.length - 2);
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function compact(value: string): string {
  return tokenize(value).join("");
}
