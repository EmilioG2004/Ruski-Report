import { Worksheet } from "exceljs";

import {
  CANONICAL_SCORECARD_LAYOUT_VERSION,
  CANONICAL_WORKBOOK_SCHEMA_VERSION
} from "../schema";
import {
  CanonicalWorkbookGenerationInput,
  CanonicalWorkbookMatchInput
} from "./types";

const DARK_FILL = "FF34495E";
const HEADER_FILL = "FFDCE6F1";

export function buildControlSheet(
  worksheet: Worksheet,
  input: CanonicalWorkbookGenerationInput,
  sheetNamesByMatchId: ReadonlyMap<string, string>
): void {
  const playersPerTeam = input.teams[0].players.length;
  const lastContentColumn = Math.max(7, 3 + playersPerTeam);
  const lastContentColumnName = columnName(lastContentColumn);
  worksheet.mergeCells(`A1:${lastContentColumnName}1`);
  const title = worksheet.getCell("A1");
  title.value = `${input.tournament.name} · Tournament Control`;
  title.font = { name: "Arial", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = solidFill(DARK_FILL);
  title.alignment = { vertical: "middle" };
  worksheet.getRow(1).height = 25;

  const details: ReadonlyArray<readonly [string, string | number | Date]> = [
    ["Tournament", input.tournament.name],
    ["Year", input.tournament.year],
    ["Tournament ID", input.tournament.id],
    ["Lifecycle", input.tournament.lifecycle],
    ["Workbook schema version", CANONICAL_WORKBOOK_SCHEMA_VERSION],
    ["Scorecard layout version", CANONICAL_SCORECARD_LAYOUT_VERSION],
    ["Generation revision", input.generation.revision],
    ["Generated", new Date(input.generation.generatedAt)]
  ];
  details.forEach(([label, value], index) => {
    const row = index + 3;
    worksheet.getCell(row, 1).value = label;
    worksheet.getCell(row, 1).font = { name: "Arial", bold: true };
    worksheet.getCell(row, 2).value = value;
  });
  worksheet.getCell("B10").numFmt = "yyyy-mm-dd hh:mm";

  const rosterHeaderRow = 13;
  worksheet.getCell(rosterHeaderRow - 1, 1).value = "Published roster";
  worksheet.getCell(rosterHeaderRow - 1, 1).font = { name: "Arial", size: 13, bold: true };
  writeHeaderRow(worksheet, rosterHeaderRow, [
    "Pod",
    "Initial seed",
    "Team",
    ...Array.from(
      { length: playersPerTeam },
      (_, index) => `Player ${index + 1}`
    )
  ]);

  const podById = new Map(input.pods.map((pod) => [pod.id, pod]));
  const sortedTeams = [...input.teams].sort((left, right) =>
    (podById.get(left.podId)?.sequence ?? 0) -
      (podById.get(right.podId)?.sequence ?? 0) ||
    left.initialSeed - right.initialSeed ||
    left.sequence - right.sequence
  );
  sortedTeams.forEach((team, index) => {
    const row = rosterHeaderRow + 1 + index;
    const players = [...team.players].sort(
      (left, right) => left.rosterSlot - right.rosterSlot
    );
    worksheet.getRow(row).values = [
      podById.get(team.podId)?.name ?? "",
      team.initialSeed,
      team.name,
      ...players.map((player) => player.displayName)
    ];
  });

  const matchTitleRow = rosterHeaderRow + sortedTeams.length + 3;
  worksheet.getCell(matchTitleRow, 1).value = "Generated match sheets";
  worksheet.getCell(matchTitleRow, 1).font = { name: "Arial", size: 13, bold: true };
  const matchHeaderRow = matchTitleRow + 1;
  writeHeaderRow(worksheet, matchHeaderRow, [
    "Sheet",
    "Pod",
    "Round",
    "Game",
    "Left team",
    "Right team",
    "Status"
  ]);

  const teamById = new Map(input.teams.map((team) => [team.id, team]));
  sortedMatches(input.matches).forEach((match, index) => {
    const row = matchHeaderRow + 1 + index;
    worksheet.getRow(row).values = [
      sheetNamesByMatchId.get(match.id) ?? "",
      match.stage === "pod_play"
        ? podById.get(match.podId)?.name ?? ""
        : "Playoffs",
      match.roundNumber,
      match.stage === "pod_play"
        ? match.gameNumberForPair
        : match.sequenceInRound,
      teamById.get(match.participantTeamIds[0])?.name ?? "",
      teamById.get(match.participantTeamIds[1])?.name ?? "",
      "SCHEDULED"
    ];
  });

  const finalRow = matchHeaderRow + input.matches.length;
  worksheet.views = [{ state: "frozen", ySplit: 2, topLeftCell: "A3", showGridLines: false }];
  worksheet.autoFilter = `A${matchHeaderRow}:G${Math.max(matchHeaderRow, finalRow)}`;
  worksheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printArea: `A1:${lastContentColumnName}${Math.max(finalRow, rosterHeaderRow)}`,
    margins: {
      left: 0.25,
      right: 0.25,
      top: 0.4,
      bottom: 0.4,
      header: 0.2,
      footer: 0.2
    }
  };
  worksheet.columns = [
    { width: 29 },
    { width: 19 },
    { width: 31 },
    ...Array.from({ length: playersPerTeam }, () => ({ width: 27 })),
    ...Array.from(
      { length: Math.max(0, 7 - 3 - playersPerTeam) },
      (_, index) => ({ width: index === 7 - 3 - playersPerTeam - 1 ? 15 : 27 })
    )
  ];
  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.font = { ...cell.font, name: "Arial" };
      cell.alignment = { ...cell.alignment, vertical: "middle" };
    });
  });
}

function columnName(columnNumber: number): string {
  return String.fromCharCode("A".charCodeAt(0) + columnNumber - 1);
}

function writeHeaderRow(
  worksheet: Worksheet,
  rowNumber: number,
  labels: readonly string[]
): void {
  labels.forEach((label, index) => {
    const cell = worksheet.getCell(rowNumber, index + 1);
    cell.value = label;
    cell.font = { name: "Arial", bold: true };
    cell.fill = solidFill(HEADER_FILL);
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FF000000" } } };
  });
  worksheet.getRow(rowNumber).height = 22;
}

function sortedMatches(
  matches: readonly CanonicalWorkbookMatchInput[]
): CanonicalWorkbookMatchInput[] {
  return [...matches].sort((left, right) => left.sequence - right.sequence);
}

function solidFill(argb: string): {
  type: "pattern";
  pattern: "solid";
  fgColor: { argb: string };
} {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}
