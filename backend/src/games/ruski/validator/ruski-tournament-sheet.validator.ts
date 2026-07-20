import { ParsedScorebook, ParsedScorebookRow } from "../../parsed-scorebook";
import { ValidationIssue } from "../../validation-result";
import { ruskiTournamentConfig } from "../config/ruski-tournament-config";
import { RUSKI_SCOREBOOK_SHEET_NAMES } from "../scorebook";
import { validationError } from "./ruski-validation";

const tournamentSheetConfiguration = {
  podCount: ruskiTournamentConfig.podCount,
  teamsPerPod: ruskiTournamentConfig.teamsPerPod,
  teamCount:
    ruskiTournamentConfig.podCount * ruskiTournamentConfig.teamsPerPod,
  bracketSlotCounts: new Map([
    ["sweet-16", 16],
    ["elite-8", 8],
    ["final-4", 4],
    ["championship", 2]
  ])
} as const;

export function validateRuskiTournamentSheets(
  parsed: ParsedScorebook
): ValidationIssue[] {
  const standings = getRows(parsed, RUSKI_SCOREBOOK_SHEET_NAMES.regularSeasonStandings);
  const teamStatistics = getRows(parsed, RUSKI_SCOREBOOK_SHEET_NAMES.teamStats);
  const bracket = getRows(parsed, RUSKI_SCOREBOOK_SHEET_NAMES.playoffBracket);

  return [
    ...validateRowsPresent(parsed),
    ...validateStandingStructure(standings),
    ...validateTeamStatisticIdentities(standings, teamStatistics),
    ...validateBracketStructure(bracket)
  ];
}

function validateRowsPresent(parsed: ParsedScorebook): ValidationIssue[] {
  return [
    RUSKI_SCOREBOOK_SHEET_NAMES.regularSeasonStandings,
    RUSKI_SCOREBOOK_SHEET_NAMES.seasonStats,
    RUSKI_SCOREBOOK_SHEET_NAMES.teamStats,
    RUSKI_SCOREBOOK_SHEET_NAMES.playoffStats,
    RUSKI_SCOREBOOK_SHEET_NAMES.playoffBracket
  ].flatMap((sheetName) => {
    const sheet = parsed.sheets.find((candidate) => candidate.name === sheetName);
    if (sheet === undefined || sheet.rows !== undefined) {
      return [];
    }
    return [
      validationError(
        "MISSING_PARSED_SHEET_ROWS",
        `Required Ruski sheet '${sheetName}' has no parsed rows.`,
        `sheets.${sheetName}.rows`,
        { sheetName }
      )
    ];
  });
}

function validateStandingStructure(rows: readonly ParsedScorebookRow[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (rows.length !== tournamentSheetConfiguration.teamCount) {
    issues.push(
      validationError(
        "INVALID_STANDING_TEAM_COUNT",
        `Regular Season Standings contains ${rows.length} teams; expected ${tournamentSheetConfiguration.teamCount}.`,
        `sheets.${RUSKI_SCOREBOOK_SHEET_NAMES.regularSeasonStandings}.rows`,
        { expected: tournamentSheetConfiguration.teamCount, actual: rows.length }
      )
    );
  }

  const teamNames = rows.flatMap((row) =>
    typeof row.values.team === "string" ? [row.values.team] : []
  );
  const duplicateTeamNames = teamNames.filter(
    (name, index) => teamNames.indexOf(name) !== index
  );

  if (duplicateTeamNames.length > 0) {
    issues.push(
      validationError(
        "DUPLICATE_STANDING_TEAM",
        `Regular Season Standings contains duplicate team '${duplicateTeamNames[0]}'.`,
        `sheets.${RUSKI_SCOREBOOK_SHEET_NAMES.regularSeasonStandings}.rows`,
        { teamName: duplicateTeamNames[0] }
      )
    );
  }

  const pods = groupBy(rows, (row) => String(row.values.podName ?? ""));
  if (pods.size !== tournamentSheetConfiguration.podCount) {
    issues.push(
      validationError(
        "INVALID_POD_COUNT",
        `Regular Season Standings contains ${pods.size} pods; expected ${tournamentSheetConfiguration.podCount}.`,
        `sheets.${RUSKI_SCOREBOOK_SHEET_NAMES.regularSeasonStandings}.rows`,
        { expected: tournamentSheetConfiguration.podCount, actual: pods.size }
      )
    );
  }

  pods.forEach((podRows, podName) => {
    if (podRows.length !== tournamentSheetConfiguration.teamsPerPod) {
      issues.push(
        validationError(
          "INVALID_POD_TEAM_COUNT",
          `${podName || "Unnamed pod"} contains ${podRows.length} teams; expected ${tournamentSheetConfiguration.teamsPerPod}.`,
          `sheets.${RUSKI_SCOREBOOK_SHEET_NAMES.regularSeasonStandings}.pods.${podName}`,
          {
            podName,
            expected: tournamentSheetConfiguration.teamsPerPod,
            actual: podRows.length
          }
        )
      );
    }
  });

  return issues;
}

function validateTeamStatisticIdentities(
  standings: readonly ParsedScorebookRow[],
  teamStatistics: readonly ParsedScorebookRow[]
): ValidationIssue[] {
  return standings.flatMap((standing) => {
    const teamName = standing.values.team;
    const shooting = standing.values.shootingPercentage;
    if (typeof teamName !== "string" || typeof shooting !== "number") {
      return [];
    }

    const matches = teamStatistics.filter((row) =>
      typeof row.values.shootingPercentage === "number" &&
      Math.abs(row.values.shootingPercentage - shooting) <=
        ruskiTournamentConfig.identity.shootingPercentageTolerance
    );

    if (matches.length === 1) {
      return [];
    }

    return [
      validationError(
        "TEAM_STAT_IDENTITY_MISMATCH",
        `Standing team '${teamName}' maps to ${matches.length} Team Stats rows by shooting percentage; expected one.`,
        `sheets.${RUSKI_SCOREBOOK_SHEET_NAMES.teamStats}.rows`,
        { teamName, shootingPercentage: shooting, matchCount: matches.length }
      )
    ];
  });
}

function validateBracketStructure(rows: readonly ParsedScorebookRow[]): ValidationIssue[] {
  const slotRows = rows.filter((row) => typeof row.values.roundId === "string");
  const rounds = groupBy(slotRows, (row) => String(row.values.roundId));

  return [...tournamentSheetConfiguration.bracketSlotCounts].flatMap(
    ([roundId, expected]) => {
      const actual = rounds.get(roundId)?.length ?? 0;
      if (actual === expected) {
        return [];
      }
      return [
        validationError(
          "INVALID_BRACKET_ROUND_SIZE",
          `Bracket round '${roundId}' contains ${actual} slots; expected ${expected}.`,
          `sheets.${RUSKI_SCOREBOOK_SHEET_NAMES.playoffBracket}.rounds.${roundId}`,
          { roundId, expected, actual }
        )
      ];
    }
  );
}

function getRows(parsed: ParsedScorebook, sheetName: string): ParsedScorebookRow[] {
  return parsed.sheets.find((sheet) => sheet.name === sheetName)?.rows ?? [];
}

function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  return values.reduce((groups, value) => {
    const groupKey = key(value);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), value]);
    return groups;
  }, new Map<string, T[]>());
}
