import { ExcelWorksheetReader } from "../../excel-workbook-reader";
import { ScorebookSheetRole } from "../../parsed-scorebook";
import { findScorebookHeaderMismatches } from "../../scorebook-schema";
import { ruskiScorebookSchema } from "../scorebook";

const summarySheetRoles = new Map<string, ScorebookSheetRole>(
  ruskiScorebookSchema.summarySheets.map((sheet) => [
    sheet.sheetName,
    sheet.kind
  ])
);

export function classifyRuskiSheet(
  worksheet: ExcelWorksheetReader
): ScorebookSheetRole {
  if (worksheet.name === ruskiScorebookSchema.blankScorecard.sheetName) {
    return "template";
  }

  const summaryRole = summarySheetRoles.get(worksheet.name);

  if (summaryRole !== undefined) {
    return summaryRole;
  }

  if (
    ruskiScorebookSchema.gameSheets.excludeSheetNames.includes(worksheet.name)
  ) {
    return "unknown";
  }

  const headerMismatches = findScorebookHeaderMismatches(
    ruskiScorebookSchema.gameSheets.requiredHeaderGroups,
    (cell) => worksheet.readCell(cell)
  );

  return headerMismatches.length === 0 ? "game" : "unknown";
}
