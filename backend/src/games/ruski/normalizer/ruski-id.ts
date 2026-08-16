export function createStableId(prefix: string, value: string): string {
  return `${prefix}-${slugify(value)}`;
}

export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "unknown";
}

export function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function getLastName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  return parts.at(-1) ?? displayName;
}

export function createTeamKey(playerNames: readonly string[]): string {
  return playerNames.map(normalizeName).sort().join("|");
}

export function createTeamName(playerNames: readonly string[]): string {
  return playerNames.map(getLastName).join("/");
}
