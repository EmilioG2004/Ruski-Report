import {
  ParsedScorebookSheet,
  ParsedScorebookShotRow,
  ParsedScorebookSide
} from "../../parsed-scorebook";
import { ValidationIssue } from "../../validation-result";
import { RUSKI_EVENT_TYPE_IDS } from "../definition";
import {
  knownEventIds,
  specialMissEventIds,
  validationError
} from "./ruski-validation";

export function validateRuskiShotRow(
  sheet: ParsedScorebookSheet,
  side: ParsedScorebookSide,
  row: ParsedScorebookShotRow
): ValidationIssue[] {
  const path = `sheets.${sheet.name}.sides.${side.id}.shotRows.${row.rowNumber}`;
  const activeEvents = Object.entries(row.eventFlags)
    .filter(([, active]) => active)
    .map(([eventId]) => eventId);

  return [
    ...validateShotNumber(sheet, side, row, path),
    ...validateShooter(sheet, side, row, path),
    ...validateEventIds(sheet, side, row, path),
    ...validateEventCombination(sheet, side, row, activeEvents, path)
  ];
}

function validateShotNumber(
  sheet: ParsedScorebookSheet,
  side: ParsedScorebookSide,
  row: ParsedScorebookShotRow,
  path: string
): ValidationIssue[] {
  if (
    row.shotNumber !== null &&
    Number.isInteger(row.shotNumber) &&
    row.shotNumber > 0
  ) {
    return [];
  }

  return [
    validationError(
      "INVALID_SHOT_NUMBER",
      `Game sheet '${sheet.name}' side '${side.id}' row ${row.rowNumber} has an invalid shot number.`,
      `${path}.shotNumber`,
      {
        sheetName: sheet.name,
        sideId: side.id,
        rowNumber: row.rowNumber,
        actual: row.shotNumber
      }
    )
  ];
}

function validateShooter(
  sheet: ParsedScorebookSheet,
  side: ParsedScorebookSide,
  row: ParsedScorebookShotRow,
  path: string
): ValidationIssue[] {
  if (row.shooterName !== null) {
    return [];
  }

  return [
    validationError(
      "MISSING_SHOOTER",
      `Game sheet '${sheet.name}' side '${side.id}' row ${row.rowNumber} is missing a shooter.`,
      `${path}.shooterName`,
      {
        sheetName: sheet.name,
        sideId: side.id,
        rowNumber: row.rowNumber
      }
    )
  ];
}

function validateEventIds(
  sheet: ParsedScorebookSheet,
  side: ParsedScorebookSide,
  row: ParsedScorebookShotRow,
  path: string
): ValidationIssue[] {
  return Object.keys(row.eventFlags).flatMap((eventId) => {
    if (knownEventIds.has(eventId)) {
      return [];
    }

    return [
      validationError(
        "UNKNOWN_EVENT_FLAG",
        `Game sheet '${sheet.name}' side '${side.id}' row ${row.rowNumber} has unknown event flag '${eventId}'.`,
        `${path}.eventFlags.${eventId}`,
        {
          sheetName: sheet.name,
          sideId: side.id,
          rowNumber: row.rowNumber,
          eventId
        }
      )
    ];
  });
}

function validateEventCombination(
  sheet: ParsedScorebookSheet,
  side: ParsedScorebookSide,
  row: ParsedScorebookShotRow,
  activeEvents: string[],
  path: string
): ValidationIssue[] {
  const hasMake = activeEvents.includes(RUSKI_EVENT_TYPE_IDS.make);
  const hasMiss = activeEvents.includes(RUSKI_EVENT_TYPE_IDS.miss);
  const activeSpecialMisses = specialMissEventIds.filter((eventId) =>
    activeEvents.includes(eventId)
  );

  if (hasMake && (hasMiss || activeSpecialMisses.length > 0)) {
    return [
      validationError(
        "INVALID_EVENT_COMBINATION",
        `Game sheet '${sheet.name}' side '${side.id}' row ${row.rowNumber} combines make with miss-only events.`,
        `${path}.eventFlags`,
        {
          sheetName: sheet.name,
          sideId: side.id,
          rowNumber: row.rowNumber,
          activeEvents
        }
      )
    ];
  }

  if (activeSpecialMisses.length > 0 && !hasMiss) {
    return [
      validationError(
        "MISSING_SPECIAL_MISS_FLAG",
        `Game sheet '${sheet.name}' side '${side.id}' row ${row.rowNumber} has a special miss without the Miss flag.`,
        `${path}.eventFlags`,
        {
          sheetName: sheet.name,
          sideId: side.id,
          rowNumber: row.rowNumber,
          activeEvents
        }
      )
    ];
  }

  return [];
}
