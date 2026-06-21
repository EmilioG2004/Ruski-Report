import { createHash } from "node:crypto";

import {
  ExcelWorkbookReader,
  ExcelWorksheetReader
} from "../../excel-workbook-reader";
import {
  ParsedScorebook,
  ParsedScorebookSheet,
  ScorebookSheetRole
} from "../../parsed-scorebook";
import { ScorebookFile } from "../../scorebook-file";
import { ScorebookTabularSheetParser } from "../../scorebook-tabular-sheet.parser";
import { RUSKI_GAME_TYPE } from "../definition";
import {
  RUSKI_SCOREBOOK_SHEET_NAMES,
  ruskiScorebookSchema
} from "../scorebook";
import { RuskiScorecardSheetParser } from "./ruski-scorecard-sheet.parser";
import { classifyRuskiSheet } from "./ruski-sheet-classifier";

export class RuskiScorebookParser {
  private readonly scorecardSheetParser = new RuskiScorecardSheetParser();
  private readonly tabularSheetParser = new ScorebookTabularSheetParser();

  async parseScorebook(file: ScorebookFile): Promise<ParsedScorebook> {
    const workbook = await ExcelWorkbookReader.load(file);
    const sheets = workbook.worksheets.map((worksheet) =>
      this.parseSheet(worksheet)
    );

    return {
      gameType: RUSKI_GAME_TYPE,
      source: {
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes ?? file.buffer.byteLength,
        checksum: createHash("sha256").update(file.buffer).digest("hex"),
        metadata: file.metadata
      },
      sheets,
      metadata: {
        sheetCounts: countSheetRoles(sheets)
      }
    };
  }

  private parseSheet(worksheet: ExcelWorksheetReader): ParsedScorebookSheet {
    const role = classifyRuskiSheet(worksheet);
    const sheet: ParsedScorebookSheet = {
      name: worksheet.name,
      index: worksheet.index,
      role
    };

    if (role === "game") {
      return {
        ...sheet,
        game: this.scorecardSheetParser.parse(worksheet)
      };
    }

    if (role === "template") {
      return {
        ...sheet,
        metadata: {
          status: worksheet.readCell(
            ruskiScorebookSchema.blankScorecard.statusCell
          )
        }
      };
    }

    if (
      role === "data" &&
      worksheet.name === RUSKI_SCOREBOOK_SHEET_NAMES.allData
    ) {
      const allDataSchema = ruskiScorebookSchema.summarySheets.find(
        (schema) => schema.sheetName === RUSKI_SCOREBOOK_SHEET_NAMES.allData
      );

      if (allDataSchema?.dataRange !== undefined) {
        return {
          ...sheet,
          rows: this.tabularSheetParser.parse(worksheet, {
            headers: allDataSchema.headers,
            dataRange: allDataSchema.dataRange
          })
        };
      }
    }

    return sheet;
  }
}

function countSheetRoles(
  sheets: readonly ParsedScorebookSheet[]
): Record<ScorebookSheetRole, number> {
  return sheets.reduce<Record<ScorebookSheetRole, number>>(
    (counts, sheet) => ({
      ...counts,
      [sheet.role]: counts[sheet.role] + 1
    }),
    {
      bracket: 0,
      summary: 0,
      template: 0,
      game: 0,
      data: 0,
      unknown: 0
    }
  );
}
