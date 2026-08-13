export function readJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

export function writeJson(value: unknown): string {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new TypeError("PostgreSQL JSON values must be JSON-serializable.");
  }

  return serialized;
}

export function writeOptionalJson(value: unknown): string | null {
  return value === null || value === undefined ? null : writeJson(value);
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
