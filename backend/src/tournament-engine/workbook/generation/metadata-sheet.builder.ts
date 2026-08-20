import { Worksheet } from "exceljs";

import {
  CANONICAL_SCORECARD_LAYOUT_VERSION,
  CANONICAL_WORKBOOK_MAGIC,
  CANONICAL_WORKBOOK_SCHEMA_VERSION
} from "../schema";
import {
  CanonicalWorkbookGenerationInput,
  CanonicalWorkbookSheetManifestEntry
} from "./types";

export function buildMetadataSheet(
  worksheet: Worksheet,
  input: CanonicalWorkbookGenerationInput,
  manifest: readonly CanonicalWorkbookSheetManifestEntry[]
): void {
  const matchById = new Map(input.matches.map((match) => [match.id, match]));
  const globalMetadata: ReadonlyArray<readonly [string, string | number]> = [
    ["magic", CANONICAL_WORKBOOK_MAGIC],
    ["workbookSchemaVersion", CANONICAL_WORKBOOK_SCHEMA_VERSION],
    ["scorecardLayoutVersion", CANONICAL_SCORECARD_LAYOUT_VERSION],
    ["tournamentId", input.tournament.id],
    ["generationId", input.generation.id],
    ["generationRevision", input.generation.revision],
    ["generationSourceDigest", input.generation.sourceDigest],
    ["generatedAt", input.generation.generatedAt]
  ];
  globalMetadata.forEach(([key, value], index) => {
    worksheet.getCell(index + 1, 1).value = key;
    worksheet.getCell(index + 1, 2).value = value;
  });

  const headers = [
    "sheetId",
    "sheetName",
    "sheetKind",
    "matchId",
    "stage",
    "podId",
    "bracketMatchId",
    "team1Id",
    "team2Id",
    "baselineFingerprint"
  ];
  headers.forEach((header, index) => {
    worksheet.getCell(11, index + 1).value = header;
  });
  manifest
    .filter((entry) => entry.sheetKind === "blank" || entry.sheetKind === "game")
    .forEach((entry, index) => {
      const row = index + 12;
      const game = entry.sheetKind === "game" ? entry : undefined;
      const match = game === undefined ? undefined : matchById.get(game.matchId);
      worksheet.getRow(row).values = [
        entry.sheetId,
        entry.sheetName,
        entry.sheetKind,
        entry.matchId,
        game?.stage ?? null,
        match?.podId ?? null,
        game?.bracketMatchId ?? null,
        game?.teamIds[0] ?? null,
        game?.teamIds[1] ?? null,
        entry.baselineFingerprint
      ];
    });
  worksheet.state = "veryHidden";
}
