import { ParsedScorebook, ParsedScorebookRow, ParsedScorebookSheet } from "../../parsed-scorebook";
import { RUSKI_SCOREBOOK_SHEET_NAMES } from "../scorebook";

export interface RuskiStandingSourceRow {
  podName: string;
  podSequence: number;
  seed: number;
  teamName: string;
  record: string;
  cupDifferential: number;
  shootingPercentage: number;
  sequence: number;
}

export interface RuskiStatisticSourceRow {
  subjectLabel: string;
  values: Record<string, number | null>;
  rank: number;
}

export interface RuskiTournamentSource {
  standings: RuskiStandingSourceRow[];
  seasonPlayerStatistics: RuskiStatisticSourceRow[];
  seasonTeamStatistics: RuskiStatisticSourceRow[];
  playoffPlayerStatistics: RuskiStatisticSourceRow[];
  bracketRows: ParsedScorebookRow[];
  gameSheets: ParsedScorebookSheet[];
}

const statisticKeys = [
  "shootingPercentage",
  "makes",
  "misses",
  "splashOuts",
  "guys",
  "tris",
  "dis",
  "uns",
  "voms"
] as const;

export function readRuskiTournamentSource(
  parsed: ParsedScorebook
): RuskiTournamentSource {
  return {
    standings: readStandings(requireRows(parsed, RUSKI_SCOREBOOK_SHEET_NAMES.regularSeasonStandings)),
    seasonPlayerStatistics: readStatistics(
      requireRows(parsed, RUSKI_SCOREBOOK_SHEET_NAMES.seasonStats),
      "name"
    ),
    seasonTeamStatistics: readStatistics(
      requireRows(parsed, RUSKI_SCOREBOOK_SHEET_NAMES.teamStats),
      "team"
    ),
    playoffPlayerStatistics: readStatistics(
      requireRows(parsed, RUSKI_SCOREBOOK_SHEET_NAMES.playoffStats),
      "name"
    ),
    bracketRows: requireRows(parsed, RUSKI_SCOREBOOK_SHEET_NAMES.playoffBracket),
    gameSheets: parsed.sheets.filter(
      (sheet) => sheet.role === "game" && sheet.game !== undefined
    )
  };
}

function requireRows(parsed: ParsedScorebook, sheetName: string): ParsedScorebookRow[] {
  const rows = parsed.sheets.find((sheet) => sheet.name === sheetName)?.rows;

  if (rows === undefined) {
    throw new Error(`Ruski sheet '${sheetName}' was not parsed into rows.`);
  }

  return rows;
}

function readStandings(rows: readonly ParsedScorebookRow[]): RuskiStandingSourceRow[] {
  return rows.map((row, sequence) => ({
    podName: requireString(row, "podName"),
    podSequence: requireNumber(row, "podSequence"),
    seed: requireNumber(row, "seed"),
    teamName: requireString(row, "team"),
    record: requireString(row, "record"),
    cupDifferential: parseSignedNumber(row.values.cupDifferential, row),
    shootingPercentage: requireNumber(row, "shootingPercentage"),
    sequence: sequence + 1
  }));
}

function readStatistics(
  rows: readonly ParsedScorebookRow[],
  subjectKey: "name" | "team"
): RuskiStatisticSourceRow[] {
  return rows.map((row, index) => ({
    subjectLabel: requireString(row, subjectKey),
    rank: index + 1,
    values: Object.fromEntries(
      statisticKeys.map((key) => [key, readOptionalNumber(row, key)])
    )
  }));
}

function requireString(row: ParsedScorebookRow, key: string): string {
  const value = row.values[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected string '${key}' in parsed row ${row.rowNumber}.`);
  }

  return value;
}

function requireNumber(row: ParsedScorebookRow, key: string): number {
  const value = row.values[key];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected number '${key}' in parsed row ${row.rowNumber}.`);
  }

  return value;
}

function readOptionalNumber(row: ParsedScorebookRow, key: string): number | null {
  const value = row.values[key];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected numeric '${key}' in parsed row ${row.rowNumber}.`);
  }

  return value;
}

function parseSignedNumber(
  value: ParsedScorebookRow["values"][string],
  row: ParsedScorebookRow
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && /^[+-]?\d+$/.test(value)) {
    return Number(value);
  }

  throw new Error(`Expected cup differential in parsed row ${row.rowNumber}.`);
}
