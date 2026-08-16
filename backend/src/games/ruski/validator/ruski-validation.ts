import { Metadata } from "../../../domain";
import {
  ParsedScorebookSheet,
  ParsedScorebookShotRow,
  ParsedScorebookSide
} from "../../parsed-scorebook";
import { ScorebookHeaderMismatch } from "../../scorebook-schema";
import { ValidationIssue } from "../../validation-result";
import { RUSKI_EVENT_TYPE_IDS } from "../definition";

export const allowedGameStatuses = new Set<string>(["LIVE GAME", "FINAL"]);
export const knownEventIds = new Set<string>(Object.values(RUSKI_EVENT_TYPE_IDS));
export const specialMissEventIds = [
  RUSKI_EVENT_TYPE_IDS.splashOut,
  RUSKI_EVENT_TYPE_IDS.guy,
  RUSKI_EVENT_TYPE_IDS.tri,
  RUSKI_EVENT_TYPE_IDS.di
];

export function validationError(
  code: string,
  message: string,
  path: string,
  metadata?: Metadata
): ValidationIssue {
  return {
    code,
    message,
    severity: "error",
    path,
    metadata
  };
}

export function getHeaderMismatches(
  sheet: ParsedScorebookSheet
): ScorebookHeaderMismatch[] {
  const mismatches = sheet.metadata?.headerMismatches;
  return Array.isArray(mismatches)
    ? (mismatches as ScorebookHeaderMismatch[])
    : [];
}

export function countShotRowEvents(
  rows: readonly ParsedScorebookShotRow[]
): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    Object.entries(row.eventFlags).forEach(([eventId, active]) => {
      if (active) {
        counts[eventId] = (counts[eventId] ?? 0) + 1;
      }
    });

    return counts;
  }, {});
}

export function countBoxScoreTotals(
  side: ParsedScorebookSide
): Record<string, number> {
  return side.boxScoreTotals.reduce<Record<string, number>>((counts, total) => {
    Object.values(RUSKI_EVENT_TYPE_IDS).forEach((eventId) => {
      counts[eventId] = (counts[eventId] ?? 0) + (total.stats[eventId] ?? 0);
    });

    return counts;
  }, {});
}
