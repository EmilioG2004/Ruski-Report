export function readJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

export function readOptionalJson<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const parsed = readJson<T>(value);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Object.keys(parsed).length === 0
  ) {
    return undefined;
  }

  return parsed;
}

export function readISOString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
