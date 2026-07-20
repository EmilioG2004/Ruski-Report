import { ExcelWorksheetReader } from "../../excel-workbook-reader";
import { ParsedScorebookCellValue, ParsedScorebookRow } from "../../parsed-scorebook";
import { ruskiBracketRoundLayouts, ruskiChampionCell } from "../scorebook";

export class RuskiBracketSheetParser {
  parse(worksheet: ExcelWorksheetReader): ParsedScorebookRow[] {
    const rows = ruskiBracketRoundLayouts.flatMap((round) =>
      round.matches.flatMap((match) =>
        match.slots.map((slot, slotIndex): ParsedScorebookRow => {
          const parsedTeam = parseSeededTeam(worksheet.readCell(slot.teamCell));

          return {
            rowNumber: round.sequence,
            values: {
              roundId: round.id,
              roundName: round.name,
              roundSequence: round.sequence,
              bracketMatchId: match.id,
              matchSequence: match.sequence,
              slotSequence: slotIndex + 1,
              seed: parsedTeam.seed,
              team: parsedTeam.team,
              winner: readWinnerFlag(worksheet.readCell(slot.winnerCell)),
              sourceMatchId: slot.sourceMatchId ?? null
            }
          };
        })
      )
    );

    rows.push({
      rowNumber: 0,
      values: {
        champion: parseSeededTeam(worksheet.readCell(ruskiChampionCell)).team
      }
    });

    return rows;
  }
}

function parseSeededTeam(value: ParsedScorebookCellValue): {
  seed: number | null;
  team: string | null;
} {
  if (typeof value !== "string") {
    return { seed: null, team: null };
  }

  const match = /^\s*\((\d+)\)\s*(.+?)\s*$/.exec(value);

  if (match === null) {
    return { seed: null, team: value.trim() || null };
  }

  return { seed: Number(match[1]), team: match[2] };
}

function readWinnerFlag(value: ParsedScorebookCellValue): boolean {
  return value === true || value === 1 || value === "TRUE";
}
