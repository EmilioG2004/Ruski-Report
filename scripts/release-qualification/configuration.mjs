/**
 * Loads non-secret release qualification defaults and environment overrides.
 * Keeping configuration here lets every check share one validated contract.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(moduleDirectory, "../..");
const defaults = JSON.parse(
  readFileSync(resolve(moduleDirectory, "defaults.json"), "utf8")
);

export function loadQualificationConfiguration(environment = process.env) {
  const apiBaseUrl = withTrailingSlash(readHttpsUrl(
    environment.RUSKI_QUALIFICATION_API_URL ?? defaults.apiBaseUrl,
    "RUSKI_QUALIFICATION_API_URL"
  ));
  const publicBaseUrl = readHttpsUrl(
    environment.RUSKI_QUALIFICATION_PUBLIC_URL ?? defaults.publicBaseUrl,
    "RUSKI_QUALIFICATION_PUBLIC_URL"
  );

  return {
    apiBaseUrl,
    publicBaseUrl,
    gameType:
      environment.RUSKI_QUALIFICATION_GAME_TYPE ?? defaults.gameType,
    realtimeEventTimeoutMilliseconds: readPositiveInteger(
      environment.RUSKI_QUALIFICATION_REALTIME_TIMEOUT_MS ??
        defaults.realtimeEventTimeoutMilliseconds,
      "RUSKI_QUALIFICATION_REALTIME_TIMEOUT_MS"
    ),
    requestTimeoutMilliseconds: readPositiveInteger(
      environment.RUSKI_QUALIFICATION_TIMEOUT_MS ??
        defaults.requestTimeoutMilliseconds,
      "RUSKI_QUALIFICATION_TIMEOUT_MS"
    ),
    scorebookPath: resolve(
      repositoryRoot,
      environment.RUSKI_QUALIFICATION_SCOREBOOK ?? defaults.scorebookPath
    ),
    tournamentYear: readPositiveInteger(
      environment.RUSKI_QUALIFICATION_YEAR ?? defaults.tournamentYear,
      "RUSKI_QUALIFICATION_YEAR"
    ),
    repositoryRoot
  };
}

function readHttpsUrl(value, name) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS.`);
  }
  return url;
}

function withTrailingSlash(url) {
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/`;
  return url;
}

function readPositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return number;
}
