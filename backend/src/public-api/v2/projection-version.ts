import { invalidProjectionVersion } from "./public-v2.errors";

export function parseProjectionVersion(
  value: string | undefined
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!/^[1-9][0-9]*$/.test(value)) {
    throw invalidProjectionVersion(value);
  }

  const version = Number(value);
  if (!Number.isSafeInteger(version)) {
    throw invalidProjectionVersion(value);
  }

  return version;
}
