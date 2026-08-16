import {
  ParsedScorebookSheet,
  ParsedScorebookSide
} from "../../parsed-scorebook";
import { ValidationIssue } from "../../validation-result";
import { ruskiScorebookSchema } from "../scorebook";
import {
  allowedGameStatuses,
  validationError
} from "./ruski-validation";
import { validateRuskiShotRow } from "./ruski-shot-row.validator";
import { validateRuskiStatTotals } from "./ruski-stat-total.validator";

export function validateRuskiGameSheet(
  sheet: ParsedScorebookSheet
): ValidationIssue[] {
  if (sheet.role === "unknown") {
    return [
      validationError(
        "UNKNOWN_SCOREBOOK_SHEET",
        `Sheet '${sheet.name}' is not a recognized Ruski scorebook sheet.`,
        `sheets.${sheet.name}`,
        {
          sheetName: sheet.name
        }
      )
    ];
  }

  if (sheet.role !== "game") {
    return [];
  }

  if (sheet.game === undefined) {
    return [
      validationError(
        "MISSING_GAME_DATA",
        `Game sheet '${sheet.name}' was not parsed into game data.`,
        `sheets.${sheet.name}.game`,
        {
          sheetName: sheet.name
        }
      )
    ];
  }

  return [
    ...validateGameStatus(sheet),
    ...validateGameSides(sheet),
    ...validateRuskiStatTotals(sheet)
  ];
}

function validateGameStatus(sheet: ParsedScorebookSheet): ValidationIssue[] {
  const status = sheet.game?.status;

  if (
    status !== null &&
    status !== undefined &&
    allowedGameStatuses.has(status)
  ) {
    return [];
  }

  return [
    validationError(
      "INVALID_GAME_STATUS",
      `Game sheet '${sheet.name}' has invalid status '${status ?? "blank"}'.`,
      `sheets.${sheet.name}.status`,
      {
        sheetName: sheet.name,
        allowedStatuses: [...allowedGameStatuses],
        actual: status
      }
    )
  ];
}

function validateGameSides(sheet: ParsedScorebookSheet): ValidationIssue[] {
  const sides = sheet.game?.sides ?? [];
  const expectedSideCount = ruskiScorebookSchema.blankScorecard.sides.length;
  const sideIssues =
    sides.length === expectedSideCount
      ? []
      : [
          validationError(
            "INVALID_GAME_SIDE_COUNT",
            `Game sheet '${sheet.name}' has ${sides.length} sides; expected ${expectedSideCount}.`,
            `sheets.${sheet.name}.sides`,
            {
              sheetName: sheet.name,
              expected: expectedSideCount,
              actual: sides.length
            }
          )
        ];

  return [
    ...sideIssues,
    ...sides.flatMap((side, sideIndex) =>
      validateSide(sheet, side, sideIndex)
    )
  ];
}

function validateSide(
  sheet: ParsedScorebookSheet,
  side: ParsedScorebookSide,
  sideIndex: number
): ValidationIssue[] {
  const expectedPlayerCount =
    ruskiScorebookSchema.blankScorecard.sides[sideIndex]?.playerNameCells
      .length ?? 0;
  const playerIssues =
    side.players.length === expectedPlayerCount
      ? []
      : [
          validationError(
            "MISSING_PLAYER_NAMES",
            `Game sheet '${sheet.name}' side '${side.id}' has ${side.players.length} players; expected ${expectedPlayerCount}.`,
            `sheets.${sheet.name}.sides.${side.id}.players`,
            {
              sheetName: sheet.name,
              sideId: side.id,
              expected: expectedPlayerCount,
              actual: side.players.length
            }
          )
        ];

  return [
    ...playerIssues,
    ...side.shotRows.flatMap((row) => validateRuskiShotRow(sheet, side, row))
  ];
}
