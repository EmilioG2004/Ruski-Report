import { randomUUID } from "node:crypto";

import {
  HttpStatus,
  Inject,
  Injectable
} from "@nestjs/common";

import { GameType } from "../domain";
import {
  GamePluginRegistry,
  ParsedScorebook,
  ScorebookFile,
  UnsupportedGameTypeError,
  ValidationIssue,
  validationFailed,
  validationPassed
} from "../games";
import { AppError, ErrorDetail } from "../errors";
import {
  RepositoryFailure,
  RepositoryResult,
  TOURNAMENT_SNAPSHOT_REPOSITORY,
  TournamentSnapshotRepository,
  TRANSACTION_MANAGER,
  TransactionContext,
  TransactionManager,
  UPLOAD_REPORT_REPOSITORY,
  UploadReport,
  UploadReportRepository
} from "../repositories";
import { RealtimeUpdatePublisher } from "../realtime";
import { ScorebookUploadResponse } from "./scorebook-upload-response";

export interface UploadedScorebookFile {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size: number;
}

export interface UploadScorebookInput {
  year: number;
  gameType: GameType;
  file: UploadedScorebookFile;
}

@Injectable()
export class AdminScorebookService {
  constructor(
    private readonly gamePlugins: GamePluginRegistry,
    @Inject(UPLOAD_REPORT_REPOSITORY)
    private readonly uploadReports: UploadReportRepository,
    @Inject(TOURNAMENT_SNAPSHOT_REPOSITORY)
    private readonly snapshots: TournamentSnapshotRepository,
    @Inject(TRANSACTION_MANAGER)
    private readonly transactions: TransactionManager,
    private readonly realtimeUpdates: RealtimeUpdatePublisher
  ) {}

  async uploadScorebook(
    input: UploadScorebookInput
  ): Promise<ScorebookUploadResponse> {
    const receivedAt = new Date().toISOString();
    const uploadId = randomUUID();
    const plugin = this.getPlugin(input.gameType);
    let report = await this.createReceivedReport(input, uploadId, receivedAt);
    let parsed: ParsedScorebook;

    try {
      parsed = await plugin.parseScorebook(this.toScorebookFile(input, uploadId));
    } catch (error) {
      const validation = validationFailed([
        {
          code: "SCOREBOOK_PARSE_FAILED",
          message: "Scorebook could not be parsed.",
          severity: "error",
          metadata: {
            uploadId,
            reason: getErrorMessage(error)
          }
        }
      ]);

      report = await this.updateReport({
        ...report,
        status: "validation_failed",
        validation,
        completedAt: new Date().toISOString()
      });

      throw new AppError({
        code: "SCOREBOOK_VALIDATION_FAILED",
        message: "Scorebook could not be parsed.",
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        details: validationIssuesToDetails(validation.errors)
      });
    }

    const validation = plugin.validateScorebook(parsed);

    if (!validation.valid) {
      report = await this.updateReport({
        ...report,
        source: parsed.source,
        status: "validation_failed",
        validation,
        completedAt: new Date().toISOString()
      });

      return toResponse(report);
    }

    const snapshot = await plugin.normalizeScorebook(parsed);

    try {
      report = await this.transactions.runInTransaction(async (transaction) => {
        const publishResult = await this.snapshots.publishSnapshot(
          snapshot,
          transaction
        );

        if (!publishResult.ok) {
          throw toPersistenceError(
            publishResult.error,
            "Failed to publish tournament snapshot."
          );
        }

        if (publishResult.value.snapshotVersion === undefined) {
          throw new AppError({
            code: "PERSISTENCE_ERROR",
            message: "Snapshot repository did not return a published version."
          });
        }

        return this.updateReport(
          {
            ...report,
            source: parsed.source,
            status: "published",
            validation,
            tournamentId: snapshot.tournament.id,
            snapshotVersion: publishResult.value.snapshotVersion,
            completedAt: new Date().toISOString()
          },
          transaction
        );
      });
    } catch (error) {
      if (error instanceof AppError) {
        await this.updateReport({
          ...report,
          source: parsed.source,
          status: "publish_failed",
          validation,
          tournamentId: snapshot.tournament.id,
          completedAt: new Date().toISOString()
        });
      }

      throw error;
    }

    if (report.tournamentId !== undefined && report.snapshotVersion !== undefined) {
      this.realtimeUpdates.publishTournamentUpdated({
        tournamentId: report.tournamentId,
        version: report.snapshotVersion.version,
        metadata: {
          gameType: report.gameType,
          uploadId: report.id,
          publishedAt: report.snapshotVersion.publishedAt,
          previousVersion: report.snapshotVersion.previousVersion
        }
      });
    }

    return toResponse(report);
  }

  private getPlugin(gameType: GameType) {
    try {
      return this.gamePlugins.get(gameType);
    } catch (error) {
      if (error instanceof UnsupportedGameTypeError) {
        throw new AppError({
          code: "UNSUPPORTED_GAME_TYPE",
          message: error.message,
          statusCode: HttpStatus.BAD_REQUEST,
          details: [
            {
              code: "UNSUPPORTED_GAME_TYPE",
              message: error.message,
              metadata: {
                gameType: error.gameType,
                supportedGameTypes: error.supportedGameTypes
              }
            }
          ],
          cause: error
        });
      }

      throw error;
    }
  }

  private async createReceivedReport(
    input: UploadScorebookInput,
    uploadId: string,
    receivedAt: string
  ): Promise<UploadReport> {
    return this.createReport({
      id: uploadId,
      gameType: input.gameType,
      source: {
        originalName: input.file.originalname,
        mimeType: input.file.mimetype,
        sizeBytes: input.file.size,
        metadata: {
          year: input.year,
          uploadId
        }
      },
      status: "received",
      validation: validationPassed(),
      receivedAt,
      metadata: {
        year: input.year
      }
    });
  }

  private toScorebookFile(
    input: UploadScorebookInput,
    uploadId: string
  ): ScorebookFile {
    return {
      buffer: input.file.buffer,
      originalName: input.file.originalname,
      mimeType: input.file.mimetype,
      sizeBytes: input.file.size,
      uploadedAt: new Date().toISOString(),
      metadata: {
        year: input.year,
        uploadId
      }
    };
  }

  private async createReport(report: UploadReport): Promise<UploadReport> {
    const result = await this.uploadReports.create(report);
    return unwrapRepositoryResult(result, "Failed to create upload report.");
  }

  private async updateReport(
    report: UploadReport,
    transaction?: TransactionContext
  ): Promise<UploadReport> {
    const result = await this.uploadReports.update(report, transaction);
    return unwrapRepositoryResult(result, "Failed to update upload report.");
  }
}

function toResponse(report: UploadReport): ScorebookUploadResponse {
  return {
    uploadId: report.id,
    gameType: report.gameType,
    source: report.source,
    status: report.status,
    validation: report.validation,
    tournamentId: report.tournamentId,
    snapshotVersion: report.snapshotVersion,
    receivedAt: report.receivedAt,
    completedAt: report.completedAt
  };
}

function unwrapRepositoryResult<T>(
  result: RepositoryResult<T>,
  message: string
): T {
  if (result.ok) {
    return result.value;
  }

  throw toPersistenceError(result.error, message);
}

function toPersistenceError(
  failure: RepositoryFailure,
  message: string
): AppError {
  return new AppError({
    code: "PERSISTENCE_ERROR",
    message,
    details: [
      {
        code: failure.code,
        message: failure.message,
        metadata: failure.metadata
      }
    ]
  });
}

function validationIssuesToDetails(
  issues: readonly ValidationIssue[]
): ErrorDetail[] {
  return issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path,
    metadata: issue.metadata
  }));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
