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

const summarySheetsByName = new Map(
  ruskiScorebookSchema.summarySheets.map((sheet) => [sheet.sheetName, sheet])
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

  const summarySheet = summarySheetsByName.get(worksheet.name);

  if (summarySheet !== undefined) {
    return {
      role: summarySheet.kind,
      headerMismatches: findScorebookHeaderMismatches(
        [
          {
            id: `${summarySheet.sheetName}-headers`,
            label: `${summarySheet.sheetName} headers`,
            headers: summarySheet.headers
          }
        ],
        (cell) => worksheet.readCell(cell)
      )
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
