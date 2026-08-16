import { ExcelWorksheetReader } from "../../excel-workbook-reader";
import { ParsedScorebookRow } from "../../parsed-scorebook";
import { ruskiStandingBlockLayouts } from "../scorebook";

const teamsPerPod = 4;

export class RuskiStandingsSheetParser {
  parse(worksheet: ExcelWorksheetReader): ParsedScorebookRow[] {
    return ruskiStandingBlockLayouts.flatMap((block, podIndex) => {
      const podName = readString(worksheet, block.podNameCell);

      return Array.from({ length: teamsPerPod }, (_, teamIndex) => {
        const rowNumber = block.firstTeamRow + teamIndex;

        return {
          rowNumber,
          values: {
            podName,
            podSequence: podIndex + 1,
            seed: worksheet.readCell(`${block.seedColumn}${rowNumber}`),
            team: worksheet.readCell(`${block.teamColumn}${rowNumber}`),
            record: worksheet.readCell(`${block.recordColumn}${rowNumber}`),
            cupDifferential: worksheet.readCell(
              `${block.cupDifferentialColumn}${rowNumber}`
            ),
            shootingPercentage: worksheet.readCell(
              `${block.shootingPercentageColumn}${rowNumber}`
            )
          }
        } satisfies ParsedScorebookRow;
      });
    });
  }
}

function readString(
  worksheet: ExcelWorksheetReader,
  cell: string
): string | null {
  const value = worksheet.readCell(cell);
  return typeof value === "string" ? value : null;
}
