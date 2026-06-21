import {
  Controller,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import { AppError } from "../errors";
import { AdminAuthGuard } from "./admin-auth.guard";
import {
  AdminScorebookService,
  UploadedScorebookFile
} from "./admin-scorebook.service";
import { ScorebookUploadResponse } from "./scorebook-upload-response";

const XLSX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream"
]);

@Controller("admin/tournaments")
@UseGuards(AdminAuthGuard)
export class AdminScorebookController {
  constructor(private readonly scorebooks: AdminScorebookService) {}

  @Post(":year/upload-scorebook")
  @UseInterceptors(FileInterceptor("file"))
  uploadScorebook(
    @Param("year") year: string,
    @Query("gameType") gameType: string | undefined,
    @UploadedFile() file: UploadedScorebookFile | undefined
  ): Promise<ScorebookUploadResponse> {
    this.assertValidFile(file);

    return this.scorebooks.uploadScorebook({
      year: parseTournamentYear(year),
      gameType: parseGameType(gameType),
      file
    });
  }

  private assertValidFile(
    file: UploadedScorebookFile | undefined
  ): asserts file is UploadedScorebookFile {
    if (file === undefined) {
      throw new AppError({
        code: "BAD_REQUEST",
        message: "Scorebook upload requires a multipart file field named file.",
        statusCode: HttpStatus.BAD_REQUEST
      });
    }

    if (!file.originalname.toLowerCase().endsWith(".xlsx")) {
      throw new AppError({
        code: "BAD_REQUEST",
        message: "Scorebook upload must be an .xlsx file.",
        statusCode: HttpStatus.BAD_REQUEST
      });
    }

    if (
      file.mimetype !== undefined &&
      file.mimetype.length > 0 &&
      !XLSX_MIME_TYPES.has(file.mimetype)
    ) {
      throw new AppError({
        code: "BAD_REQUEST",
        message: "Scorebook upload has an unsupported file type.",
        statusCode: HttpStatus.BAD_REQUEST,
        details: [
          {
            code: "UNSUPPORTED_FILE_TYPE",
            message: `Unsupported file type "${file.mimetype}".`,
            metadata: {
              allowedMimeTypes: [...XLSX_MIME_TYPES]
            }
          }
        ]
      });
    }
  }
}

function parseTournamentYear(value: string): number {
  const year = Number(value);

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new AppError({
      code: "BAD_REQUEST",
      message: "Tournament year must be a four-digit year.",
      statusCode: HttpStatus.BAD_REQUEST,
      details: [
        {
          code: "INVALID_TOURNAMENT_YEAR",
          message: `Invalid tournament year "${value}".`,
          path: "year"
        }
      ]
    });
  }

  return year;
}

function parseGameType(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new AppError({
      code: "BAD_REQUEST",
      message: "Scorebook upload requires a gameType query parameter.",
      statusCode: HttpStatus.BAD_REQUEST,
      details: [
        {
          code: "MISSING_GAME_TYPE",
          message: "Missing gameType query parameter.",
          path: "gameType"
        }
      ]
    });
  }

  return value.trim();
}
