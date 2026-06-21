import { ExcelWorksheetReader } from "../../excel-workbook-reader";
import { ScorebookSheetRole } from "../../parsed-scorebook";
import {
  findScorebookHeaderMismatches,
  ScorebookHeaderMismatch
} from "../../scorebook-schema";
import { ruskiScorebookSchema } from "../scorebook";

export interface RuskiSheetClassification {
  role: ScorebookSheetRole;
  headerMismatches: ScorebookHeaderMismatch[];
}

const summarySheetRoles = new Map<string, ScorebookSheetRole>(
  ruskiScorebookSchema.summarySheets.map((sheet) => [
    sheet.sheetName,
    sheet.kind
  ])
);

export function classifyRuskiSheet(
  worksheet: ExcelWorksheetReader
): ScorebookSheetRole {
  return analyzeRuskiSheet(worksheet).role;
}

export function analyzeRuskiSheet(
  worksheet: ExcelWorksheetReader
): RuskiSheetClassification {
  if (worksheet.name === ruskiScorebookSchema.blankScorecard.sheetName) {
    return {
      role: "template",
      headerMismatches: findScorebookHeaderMismatches(
        ruskiScorebookSchema.blankScorecard.requiredHeaderGroups,
        (cell) => worksheet.readCell(cell)
      )
    };
  }

  const summaryRole = summarySheetRoles.get(worksheet.name);

  if (summaryRole !== undefined) {
    return {
      role: summaryRole,
      headerMismatches: []
    };
  }

  if (
    ruskiScorebookSchema.gameSheets.excludeSheetNames.includes(worksheet.name)
  ) {
    return {
      role: "unknown",
      headerMismatches: []
    };
  }

  const headerMismatches = findScorebookHeaderMismatches(
    ruskiScorebookSchema.gameSheets.requiredHeaderGroups,
    (cell) => worksheet.readCell(cell)
  );

  return {
    role: headerMismatches.length === 0 ? "game" : "unknown",
    headerMismatches
  };
}
