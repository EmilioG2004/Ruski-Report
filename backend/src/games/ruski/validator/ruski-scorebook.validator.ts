import { ParsedScorebook } from "../../parsed-scorebook";
import {
  ValidationIssue,
  validationFailed,
  validationPassed,
  ValidationResult
} from "../../validation-result";
import { RUSKI_GAME_TYPE } from "../definition";
import { ruskiScorebookSchema } from "../scorebook";
import { getHeaderMismatches, validationError } from "./ruski-validation";
import { validateRuskiGameSheet } from "./ruski-game-sheet.validator";
import { validateRuskiTournamentSheets } from "./ruski-tournament-sheet.validator";

export class RuskiScorebookValidator {
  validateScorebook(parsed: ParsedScorebook): ValidationResult {
    const errors = [
      ...validateGameType(parsed),
      ...validateRequiredSheets(parsed),
      ...validateSheetHeaders(parsed),
      ...validateRuskiTournamentSheets(parsed),
      ...parsed.sheets.flatMap(validateRuskiGameSheet)
    ];

    return errors.length > 0 ? validationFailed(errors) : validationPassed();
  }
}

function validateGameType(parsed: ParsedScorebook): ValidationIssue[] {
  if (parsed.gameType === RUSKI_GAME_TYPE) {
    return [];
  }

  return [
    validationError(
      "UNEXPECTED_GAME_TYPE",
      `Expected Ruski scorebook game type '${RUSKI_GAME_TYPE}' but received '${parsed.gameType}'.`,
      "gameType",
      {
        expected: RUSKI_GAME_TYPE,
        actual: parsed.gameType
      }
    )
  ];
}

function validateRequiredSheets(parsed: ParsedScorebook): ValidationIssue[] {
  const sheetNames = new Set(parsed.sheets.map((sheet) => sheet.name));

  return ruskiScorebookSchema.requiredSheetNames.flatMap((sheetName) => {
    if (sheetNames.has(sheetName)) {
      return [];
    }

    return [
      validationError(
        "MISSING_REQUIRED_SHEET",
        `Required Ruski scorebook sheet '${sheetName}' is missing.`,
        `sheets.${sheetName}`,
        {
          sheetName
        }
      )
    ];
  });
}

function validateSheetHeaders(parsed: ParsedScorebook): ValidationIssue[] {
  return parsed.sheets.flatMap((sheet) =>
    getHeaderMismatches(sheet).map((mismatch) =>
      validationError(
        "SCORECARD_HEADER_MISMATCH",
        `Expected '${mismatch.expected}' in ${mismatch.cell} on '${sheet.name}' but found '${mismatch.actual ?? "blank"}'.`,
        `sheets.${sheet.name}.${mismatch.cell}`,
        {
          sheetName: sheet.name,
          ...mismatch
        }
      )
    )
  );
}
