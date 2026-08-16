import {
  ParsedScorebookSheet
} from "../../parsed-scorebook";
import { ValidationIssue } from "../../validation-result";
import { RUSKI_EVENT_TYPE_IDS } from "../definition";
import {
  countBoxScoreTotals,
  countShotRowEvents,
  validationError
} from "./ruski-validation";

export function validateRuskiStatTotals(
  sheet: ParsedScorebookSheet
): ValidationIssue[] {
  return (sheet.game?.sides ?? []).flatMap((side) => {
    const rowCounts = countShotRowEvents(side.shotRows);
    const totalCounts = countBoxScoreTotals(side);

    return Object.values(RUSKI_EVENT_TYPE_IDS).flatMap((eventId) => {
      const rowCount = rowCounts[eventId] ?? 0;
      const totalCount = totalCounts[eventId] ?? 0;

      if (rowCount === totalCount) {
        return [];
      }

      return [
        validationError(
          "STAT_TOTAL_MISMATCH",
          `Game sheet '${sheet.name}' side '${side.id}' ${eventId} total is ${totalCount}; shot rows contain ${rowCount}.`,
          `sheets.${sheet.name}.sides.${side.id}.boxScoreTotals.${eventId}`,
          {
            sheetName: sheet.name,
            sideId: side.id,
            eventId,
            expectedFromRows: rowCount,
            actualTotal: totalCount
          }
        )
      ];
    });
  });
}
