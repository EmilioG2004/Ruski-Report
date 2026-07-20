import { Injectable } from "@nestjs/common";

import { Metadata } from "../../domain";
import { PostgresDatabase } from "../../database";
import { ScorebookSource, ValidationResult } from "../../games";
import {
  repositoryFailure,
  repositorySuccess,
  RepositoryResult
} from "../repository-result";
import { TransactionContext } from "../transaction";
import {
  UploadReport,
  UploadReportRepository,
  UploadReportStatus
} from "../upload-report-repository";
import { selectPostgresExecutor } from "./postgres-executor";
import { mapPostgresError } from "./postgres-repository-error";
import {
  readISOString,
  readJson,
  readOptionalJson
} from "./postgres-values";

interface UploadReportRow {
  id: string;
  game_type: string;
  status: UploadReportStatus;
  validation: unknown;
  tournament_id: string | null;
  snapshot_version: number | null;
  snapshot_published_at: Date | string | null;
  previous_snapshot_version: number | null;
  received_at: Date | string;
  completed_at: Date | string | null;
  metadata: unknown;
  original_name: string;
  mime_type: string | null;
  size_bytes: string | number | null;
  checksum: string | null;
  source_metadata: unknown;
}

@Injectable()
export class PostgresUploadReportRepository
  implements UploadReportRepository
{
  constructor(private readonly database: PostgresDatabase) {}

  async create(
    report: UploadReport,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<UploadReport>> {
    try {
      const executor = selectPostgresExecutor(this.database, transaction);
      await executor.query(createReportSql, reportParameters(report));
      return repositorySuccess(structuredClone(report));
    } catch (error) {
      return this.failure(error, "Failed to create upload report.");
    }
  }

  async update(
    report: UploadReport,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<UploadReport>> {
    try {
      const executor = selectPostgresExecutor(this.database, transaction);
      const result = await executor.query<{ id: string }>(
        updateReportSql,
        reportParameters(report)
      );

      return result.rows[0] === undefined
        ? repositoryFailure({
            code: "not_found",
            message: `Upload report "${report.id}" was not found.`
          })
        : repositorySuccess(structuredClone(report));
    } catch (error) {
      return this.failure(error, "Failed to update upload report.");
    }
  }

  async findById(
    id: string
  ): Promise<RepositoryResult<UploadReport | null>> {
    try {
      const result = await this.database.query<UploadReportRow>(
        `
          SELECT report.*, source.original_name, source.mime_type,
                 source.size_bytes, source.checksum,
                 source.metadata AS source_metadata
          FROM upload_reports report
          JOIN scorebook_sources source ON source.id = report.source_id
          WHERE report.id = $1
        `,
        [id]
      );
      const row = result.rows[0];
      return repositorySuccess(row === undefined ? null : mapUploadReport(row));
    } catch (error) {
      return this.failure(error, "Failed to read upload report.");
    }
  }

  private failure<T>(error: unknown, message: string): RepositoryResult<T> {
    return repositoryFailure(mapPostgresError(error, message));
  }
}

const sourceUpsertSql = `
  INSERT INTO scorebook_sources (
    id, original_name, mime_type, size_bytes, checksum, metadata
  ) VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (id) DO UPDATE SET
    original_name = EXCLUDED.original_name,
    mime_type = EXCLUDED.mime_type,
    size_bytes = EXCLUDED.size_bytes,
    checksum = EXCLUDED.checksum,
    metadata = EXCLUDED.metadata,
    updated_at = now()
  RETURNING id
`;

const createReportSql = `
  WITH source AS (${sourceUpsertSql})
  INSERT INTO upload_reports (
    id, game_type, source_id, status, validation, tournament_id,
    snapshot_version, snapshot_published_at, previous_snapshot_version,
    received_at, completed_at, metadata
  )
  SELECT $1, $7, source.id, $8, $9, $10, $11, $12, $13, $14, $15, $16
  FROM source
`;

const updateReportSql = `
  WITH existing AS (
    SELECT id FROM upload_reports WHERE id = $1
  ), source AS (
    INSERT INTO scorebook_sources (
      id, original_name, mime_type, size_bytes, checksum, metadata
    )
    SELECT $1, $2, $3, $4, $5, $6 FROM existing
    ON CONFLICT (id) DO UPDATE SET
      original_name = EXCLUDED.original_name,
      mime_type = EXCLUDED.mime_type,
      size_bytes = EXCLUDED.size_bytes,
      checksum = EXCLUDED.checksum,
      metadata = EXCLUDED.metadata,
      updated_at = now()
    RETURNING id
  ), updated AS (
    UPDATE upload_reports report
    SET game_type = $7,
        source_id = source.id,
        status = $8,
        validation = $9,
        tournament_id = $10,
        snapshot_version = $11,
        snapshot_published_at = $12,
        previous_snapshot_version = $13,
        received_at = $14,
        completed_at = $15,
        metadata = $16
    FROM source
    WHERE report.id = $1
    RETURNING report.id
  )
  SELECT id FROM updated
`;

function reportParameters(report: UploadReport): unknown[] {
  return [
    report.id,
    report.source.originalName,
    report.source.mimeType ?? null,
    report.source.sizeBytes ?? null,
    report.source.checksum ?? null,
    report.source.metadata ?? {},
    report.gameType,
    report.status,
    report.validation,
    report.tournamentId ?? null,
    report.snapshotVersion?.version ?? null,
    report.snapshotVersion?.publishedAt ?? null,
    report.snapshotVersion?.previousVersion ?? null,
    report.receivedAt,
    report.completedAt ?? null,
    report.metadata ?? {}
  ];
}

function mapUploadReport(row: UploadReportRow): UploadReport {
  const source: ScorebookSource = {
    originalName: row.original_name,
    mimeType: row.mime_type ?? undefined,
    sizeBytes:
      row.size_bytes === null ? undefined : Number(row.size_bytes),
    checksum: row.checksum ?? undefined,
    metadata: readOptionalJson<Metadata>(row.source_metadata)
  };
  const snapshotVersion = row.snapshot_version === null ||
    row.snapshot_published_at === null ||
    row.tournament_id === null
    ? undefined
    : {
        tournamentId: row.tournament_id,
        gameType: row.game_type,
        version: row.snapshot_version,
        publishedAt: readISOString(row.snapshot_published_at),
        previousVersion: row.previous_snapshot_version ?? undefined
      };

  return {
    id: row.id,
    gameType: row.game_type,
    source,
    status: row.status,
    validation: readJson<ValidationResult>(row.validation),
    tournamentId: row.tournament_id ?? undefined,
    snapshotVersion,
    receivedAt: readISOString(row.received_at),
    completedAt:
      row.completed_at === null ? undefined : readISOString(row.completed_at),
    metadata: readOptionalJson<Metadata>(row.metadata)
  };
}
