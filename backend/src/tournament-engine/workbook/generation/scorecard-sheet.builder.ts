import { Worksheet } from "exceljs";

import {
  CANONICAL_SCORECARD,
  CANONICAL_SCORECARD_HEADERS,
  CANONICAL_SCORECARD_LAYOUT_VERSION,
  CANONICAL_SCORECARD_METADATA_KEYS,
  CANONICAL_WORKBOOK_MAGIC,
  CANONICAL_WORKBOOK_SCHEMA_VERSION,
  CanonicalScorecardMetadataKey
} from "../schema";
import {
  CanonicalWorkbookGenerationInput,
  CanonicalWorkbookMatchInput,
  CanonicalWorkbookPlayerInput,
  CanonicalWorkbookPodInput,
  CanonicalWorkbookTeamInput
} from "./types";

export interface ScorecardBuildInput {
  readonly workbook: CanonicalWorkbookGenerationInput;
  readonly sheetId: string;
  readonly playersPerTeam: number;
  readonly match?: CanonicalWorkbookMatchInput;
  readonly pod?: CanonicalWorkbookPodInput;
  readonly teams?: readonly [CanonicalWorkbookTeamInput, CanonicalWorkbookTeamInput];
}

const DARK_FILL = "FF34495E";
const LIGHT_FILL = "FFE9EEF3";
const MISS_FILL = "FFF4CCCC";
const MAKE_FILL = "FFD9EAD3";
const THIN_BLACK = { style: "thin" as const, color: { argb: "FF000000" } };

export function buildScorecardSheet(
  worksheet: Worksheet,
  input: ScorecardBuildInput
): void {
  const teams = input.teams;
  const title = teams === undefined
    ? "UNASSIGNED SCORECARD TEMPLATE"
    : `${input.match?.stage === "playoffs"
      ? `Playoffs · Round ${input.match.roundNumber}`
      : input.pod?.name ?? "Pod play"} · ${teams[0].name} vs ${teams[1].name}`;

  configureScorecardPage(worksheet);
  writeTitle(worksheet, title);
  writeSummaryArea(worksheet, teams, input.playersPerTeam);
  writeShotGrid(worksheet, teams, input.playersPerTeam);
  writeSourceScorecard(worksheet, input.match);
  writeLocalMetadata(worksheet, input);
  writeParticipantDirectory(worksheet, teams);
  hideMetadataColumns(worksheet);
}

function writeSourceScorecard(
  worksheet: Worksheet,
  match: CanonicalWorkbookMatchInput | undefined
): void {
  const source = match?.scorecardSource;
  if (source === undefined) return;
  worksheet.getCell(CANONICAL_SCORECARD.statusCell).value = source.status;
  const columns = [
    CANONICAL_SCORECARD.markerColumns.left,
    CANONICAL_SCORECARD.markerColumns.right
  ] as const;
  source.rows.forEach((row) => {
    const markerColumns = columns[row.sideNumber - 1];
    Object.values(row.markers).forEach((marked, index) => {
      if (marked) worksheet.getCell(`${markerColumns[index]}${row.worksheetRow}`).value = "X";
    });
  });
}

function configureScorecardPage(worksheet: Worksheet): void {
  worksheet.views = [{
    state: "frozen",
    ySplit: 9,
    topLeftCell: "A10",
    activeCell: "B10",
    showGridLines: false
  }];
  worksheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 2,
    horizontalCentered: true,
    printArea: CANONICAL_SCORECARD.printArea,
    printTitlesRow: "1:9",
    margins: {
      left: 0.2,
      right: 0.2,
      top: 0.3,
      bottom: 0.3,
      header: 0.1,
      footer: 0.1
    }
  };
  const widths: Record<string, number> = {
    A: 2.5,
    B: 13,
    C: 22,
    D: 10,
    E: 10,
    F: 13,
    G: 10,
    H: 10,
    I: 10,
    J: 10,
    K: 13,
    L: 22,
    M: 10,
    N: 10,
    O: 13,
    P: 10,
    Q: 10,
    R: 10,
    S: 10,
    T: 2.5,
    U: 2.5
  };
  Object.entries(widths).forEach(([column, width]) => {
    worksheet.getColumn(column).width = width;
  });
  for (let row = 10; row <= 89; row += 1) {
    worksheet.getRow(row).height = 18;
  }
  worksheet.getRow(2).height = 23;
  worksheet.getRow(9).height = 23;
}

function writeTitle(worksheet: Worksheet, titleText: string): void {
  worksheet.mergeCells("B1:S1");
  const title = worksheet.getCell("B1");
  title.value = titleText;
  title.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = solidFill(DARK_FILL);
  title.alignment = { horizontal: "center", vertical: "middle", shrinkToFit: true };
  worksheet.getRow(1).height = 24;
}

function writeSummaryArea(
  worksheet: Worksheet,
  teams: readonly [CanonicalWorkbookTeamInput, CanonicalWorkbookTeamInput] | undefined,
  playersPerTeam: number
): void {
  worksheet.getCell("B2").value = "SCHEDULED";
  worksheet.getCell("B2").font = { name: "Arial", bold: true };
  worksheet.getCell("B2").dataValidation = {
    type: "list",
    allowBlank: false,
    showErrorMessage: true,
    errorTitle: "Invalid match status",
    error: "Choose SCHEDULED, LIVE GAME, or FINAL.",
    formulae: ['"SCHEDULED,LIVE GAME,FINAL"']
  };

  const statHeaders = CANONICAL_SCORECARD_HEADERS.slice(2);
  statHeaders.forEach((header, index) => {
    writeStatHeader(worksheet, `${columnAt("D", index)}2`, header, index);
    writeStatHeader(worksheet, `${columnAt("M", index)}2`, header, index);
  });

  writeSideSummary(worksheet, "left", teams?.[0], playersPerTeam);
  writeSideSummary(worksheet, "right", teams?.[1], playersPerTeam);
  worksheet.mergeCells("B7:S7");
  worksheet.getCell("B7").value =
    "Enter one marker per shot outcome. Special classifications accompany a miss; final validation occurs during import.";
  worksheet.getCell("B7").font = { name: "Arial", italic: true, color: { argb: "FF4A4A4A" } };
  worksheet.getCell("B7").alignment = { wrapText: true };
}

function writeSideSummary(
  worksheet: Worksheet,
  side: "left" | "right",
  team: CanonicalWorkbookTeamInput | undefined,
  playersPerTeam: number
): void {
  const playerNames = displayNames(team, playersPerTeam);
  const labelColumn = side === "left" ? "B" : "K";
  const playerColumn = side === "left" ? "C" : "L";
  const firstStatColumn = side === "left" ? "D" : "M";
  const makeColumn = side === "left" ? "E" : "N";
  const teamRange = side === "left" ? "B8:J8" : "K8:S8";

  if (playersPerTeam === 2) {
    writeTwoPlayerSummary(
      worksheet,
      labelColumn,
      playerColumn,
      firstStatColumn,
      makeColumn,
      playerNames
    );
  } else {
    writeTeamSummary(
      worksheet,
      side,
      labelColumn,
      playerColumn,
      firstStatColumn,
      makeColumn,
      playerNames
    );
  }

  worksheet.mergeCells(teamRange);
  const teamCell = worksheet.getCell(teamRange.split(":")[0]);
  teamCell.value = team?.name ?? (side === "left" ? "Unassigned left team" : "Unassigned right team");
  teamCell.font = { name: "Arial", bold: true };
  teamCell.fill = solidFill(LIGHT_FILL);
  teamCell.alignment = { horizontal: "center", vertical: "middle", shrinkToFit: true };
}

function writeTwoPlayerSummary(
  worksheet: Worksheet,
  labelColumn: string,
  playerColumn: string,
  firstStatColumn: string,
  makeColumn: string,
  playerNames: readonly string[]
): void {
  for (let slot = 1; slot <= 2; slot += 1) {
    const row = slot + 2;
    worksheet.getCell(`${labelColumn}${row}`).value = `Shooter ${slot}:`;
    worksheet.getCell(`${labelColumn}${row}`).font = { name: "Arial", bold: true };
    worksheet.getCell(`${playerColumn}${row}`).value = playerNames[slot - 1];
    worksheet.getCell(`${playerColumn}${row}`).font = { name: "Arial" };
    worksheet.getCell(`${playerColumn}${row}`).alignment = {
      vertical: "middle",
      shrinkToFit: true
    };

    for (let statIndex = 0; statIndex < 7; statIndex += 1) {
      const column = columnAt(firstStatColumn, statIndex);
      const parity = slot === 1 ? "=0" : "=1";
      worksheet.getCell(`${column}${row}`).value = {
        formula: `SUMPRODUCT((${column}$10:${column}$89<>\"\")*(MOD(ROW(${column}$10:${column}$89),2)${parity}))`,
        result: 0
      };
    }

    const percentageRow = slot + 4;
    worksheet.getCell(`${playerColumn}${percentageRow}`).value = "Shooting %";
    worksheet.getCell(`${playerColumn}${percentageRow}`).font = { name: "Arial", italic: true };
    const missCell = `${firstStatColumn}${row}`;
    const makeCell = `${makeColumn}${row}`;
    const percentageCell = worksheet.getCell(`${firstStatColumn}${percentageRow}`);
    percentageCell.value = {
      formula: `IFERROR(${makeCell}/(${makeCell}+${missCell}),0)`,
      result: 0
    };
    percentageCell.numFmt = "0.00%";
  }
}

function writeTeamSummary(
  worksheet: Worksheet,
  side: "left" | "right",
  labelColumn: string,
  playerColumn: string,
  firstStatColumn: string,
  makeColumn: string,
  playerNames: readonly string[]
): void {
  worksheet.getCell(`${labelColumn}3`).value = "Team totals:";
  worksheet.getCell(`${labelColumn}3`).font = { name: "Arial", bold: true };
  worksheet.getCell(`${playerColumn}3`).value = `${playerNames.length} players`;
  worksheet.getCell(`${playerColumn}3`).font = { name: "Arial" };

  for (let statIndex = 0; statIndex < 7; statIndex += 1) {
    const column = columnAt(firstStatColumn, statIndex);
    worksheet.getCell(`${column}3`).value = {
      formula: `COUNTIF(${column}$10:${column}$89,"<>")`,
      result: 0
    };
  }

  worksheet.getCell(`${labelColumn}4`).value = "Shooting %:";
  worksheet.getCell(`${labelColumn}4`).font = { name: "Arial", italic: true };
  const percentageCell = worksheet.getCell(`${firstStatColumn}4`);
  percentageCell.value = {
    formula: `IFERROR(${makeColumn}3/(${makeColumn}3+${firstStatColumn}3),0)`,
    result: 0
  };
  percentageCell.numFmt = "0.00%";

  worksheet.getCell(`${labelColumn}5`).value = "Roster:";
  worksheet.getCell(`${labelColumn}5`).font = { name: "Arial", bold: true };
  const rosterStart = side === "left" ? "C" : "L";
  const rosterEnd = side === "left" ? "J" : "S";
  worksheet.mergeCells(`${rosterStart}5:${rosterEnd}5`);
  const rosterCell = worksheet.getCell(`${rosterStart}5`);
  rosterCell.value = playerNames.join(" · ");
  rosterCell.font = { name: "Arial", size: 9 };
  rosterCell.alignment = { vertical: "middle", shrinkToFit: true };
}

function writeStatHeader(
  worksheet: Worksheet,
  address: string,
  label: string,
  statIndex: number
): void {
  const cell = worksheet.getCell(address);
  cell.value = label;
  cell.font = { name: "Arial", size: 9, bold: true };
  cell.fill = statIndex === 0
    ? solidFill(MISS_FILL)
    : statIndex === 1
      ? solidFill(MAKE_FILL)
      : solidFill("FFFFFFFF");
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.border = { bottom: THIN_BLACK };
}

function writeShotGrid(
  worksheet: Worksheet,
  teams: readonly [CanonicalWorkbookTeamInput, CanonicalWorkbookTeamInput] | undefined,
  playersPerTeam: number
): void {
  CANONICAL_SCORECARD_HEADERS.forEach((header, index) => {
    writeGridHeader(worksheet, CANONICAL_SCORECARD.leftHeaders[index], header, index);
    writeGridHeader(worksheet, CANONICAL_SCORECARD.rightHeaders[index], header, index);
  });
  const leftPlayerNames = displayNames(teams?.[0], playersPerTeam);
  const rightPlayerNames = displayNames(teams?.[1], playersPerTeam);

  for (let row = 10; row <= 89; row += 1) {
    const playerIndex = (row - 10) % playersPerTeam;
    const shotNumber = Math.floor((row - 10) / playersPerTeam) + 1;
    const leftDisplayRow = 20 + playerIndex;
    const rightDisplayRow = 28 + playerIndex;
    worksheet.getCell(`B${row}`).value = shotNumber;
    worksheet.getCell(`K${row}`).value = shotNumber;
    worksheet.getCell(`C${row}`).value = {
      formula: `IF($W$${leftDisplayRow}=\"\",\"\",$W$${leftDisplayRow})`,
      result: leftPlayerNames[playerIndex]
    };
    worksheet.getCell(`L${row}`).value = {
      formula: `IF($W$${rightDisplayRow}=\"\",\"\",$W$${rightDisplayRow})`,
      result: rightPlayerNames[playerIndex]
    };
    styleShotRow(worksheet, row);
  }
}

function writeGridHeader(
  worksheet: Worksheet,
  address: string,
  label: string,
  index: number
): void {
  const cell = worksheet.getCell(address);
  cell.value = label;
  cell.font = { name: "Arial", size: 9, bold: true };
  cell.fill = index === 2
    ? solidFill(MISS_FILL)
    : index === 3
      ? solidFill(MAKE_FILL)
      : solidFill("FFFFFFFF");
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.border = { bottom: THIN_BLACK };
}

function styleShotRow(worksheet: Worksheet, row: number): void {
  for (const column of ["B", "C", "K", "L"]) {
    const cell = worksheet.getCell(`${column}${row}`);
    cell.font = { name: "Arial" };
    cell.alignment = {
      horizontal: column === "B" || column === "K" ? "center" : "left",
      vertical: "middle",
      shrinkToFit: column === "C" || column === "L"
    };
  }
  for (const column of ["D", "M"]) {
    worksheet.getCell(`${column}${row}`).fill = solidFill(MISS_FILL);
  }
  for (const column of ["E", "N"]) {
    worksheet.getCell(`${column}${row}`).fill = solidFill(MAKE_FILL);
  }
}

function writeLocalMetadata(
  worksheet: Worksheet,
  input: ScorecardBuildInput
): void {
  const match = input.match;
  const teams = input.teams;
  const values: Record<CanonicalScorecardMetadataKey, string | number | null> = {
    magic: CANONICAL_WORKBOOK_MAGIC,
    workbookSchemaVersion: CANONICAL_WORKBOOK_SCHEMA_VERSION,
    scorecardLayoutVersion: CANONICAL_SCORECARD_LAYOUT_VERSION,
    tournamentId: input.workbook.tournament.id,
    generationId: input.workbook.generation.id,
    generationRevision: input.workbook.generation.revision,
    generationSourceDigest: input.workbook.generation.sourceDigest,
    sheetId: input.sheetId,
    sheetKind: match === undefined ? "blank" : "game",
    matchId: match?.id ?? null,
    stage: match?.stage ?? null,
    podId: match?.stage === "pod_play" ? match.podId : null,
    bracketMatchId: match?.stage === "playoffs"
      ? match.bracketMatchId
      : null,
    team1Id: teams?.[0].id ?? null,
    team2Id: teams?.[1].id ?? null
  };
  CANONICAL_SCORECARD_METADATA_KEYS.forEach((key, index) => {
    const row = index + 1;
    worksheet.getCell(`V${row}`).value = key;
    worksheet.getCell(`W${row}`).value = values[key];
  });
  worksheet.getCell("V17").value = "playersPerTeam";
  worksheet.getCell("W17").value = input.playersPerTeam;

  const leftPlayerNames = displayNames(teams?.[0], input.playersPerTeam);
  const rightPlayerNames = displayNames(teams?.[1], input.playersPerTeam);
  for (let slot = 1; slot <= 8; slot += 1) {
    const leftRow = 19 + slot;
    const rightRow = 27 + slot;
    worksheet.getCell(`V${leftRow}`).value =
      `team1PlayerSlot${slot}DisplayName`;
    worksheet.getCell(`W${leftRow}`).value = leftPlayerNames[slot - 1] ?? null;
    worksheet.getCell(`V${rightRow}`).value =
      `team2PlayerSlot${slot}DisplayName`;
    worksheet.getCell(`W${rightRow}`).value = rightPlayerNames[slot - 1] ?? null;
  }
}

function writeParticipantDirectory(
  worksheet: Worksheet,
  teams: readonly [CanonicalWorkbookTeamInput, CanonicalWorkbookTeamInput] | undefined
): void {
  if (teams === undefined) {
    return;
  }
  teams.forEach((team, sideIndex) => {
    sortedPlayers(team.players).forEach((player) => {
      const row = sideIndex * 8 + player.rosterSlot;
      worksheet.getCell(`X${row}`).value = sideIndex + 1;
      worksheet.getCell(`Y${row}`).value = team.id;
      worksheet.getCell(`Z${row}`).value = player.id;
      worksheet.getCell(`AA${row}`).value = player.rosterMembershipId;
    });
  });
}

function hideMetadataColumns(worksheet: Worksheet): void {
  for (
    let column = CANONICAL_SCORECARD.hiddenColumns.start;
    column <= CANONICAL_SCORECARD.hiddenColumns.end;
    column += 1
  ) {
    worksheet.getColumn(column).hidden = true;
  }
}

function sortedPlayers(
  players: readonly CanonicalWorkbookPlayerInput[]
): CanonicalWorkbookPlayerInput[] {
  return [...players].sort((left, right) => left.rosterSlot - right.rosterSlot);
}

function displayNames(
  team: CanonicalWorkbookTeamInput | undefined,
  playersPerTeam: number
): string[] {
  const players = team === undefined ? [] : sortedPlayers(team.players);
  return Array.from(
    { length: playersPerTeam },
    (_, index) => players[index]?.displayName ?? `Player ${index + 1}`
  );
}

function columnAt(start: string, offset: number): string {
  return String.fromCharCode(start.charCodeAt(0) + offset);
}

function solidFill(argb: string): {
  type: "pattern";
  pattern: "solid";
  fgColor: { argb: string };
} {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}
