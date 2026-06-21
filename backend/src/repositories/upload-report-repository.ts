import {
  GameType,
  ISODateTimeString,
  Metadata,
  TournamentId
} from "../domain";
import { ScorebookSource, ValidationResult } from "../games";
import { RepositoryResult } from "./repository-result";
import { PublishedSnapshotVersion } from "./tournament-snapshot-repository";
import { TransactionContext } from "./transaction";

export const UPLOAD_REPORT_REPOSITORY = Symbol("UPLOAD_REPORT_REPOSITORY");

export type UploadReportId = string;

export type UploadReportStatus =
  | "received"
  | "validation_failed"
  | "publish_failed"
  | "published";

export interface UploadReport {
  id: UploadReportId;
  gameType: GameType;
  source: ScorebookSource;
  status: UploadReportStatus;
  validation: ValidationResult;
  tournamentId?: TournamentId;
  snapshotVersion?: PublishedSnapshotVersion;
  receivedAt: ISODateTimeString;
  completedAt?: ISODateTimeString;
  metadata?: Metadata;
}

export interface UploadReportRepository {
  create(
    report: UploadReport,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<UploadReport>>;

  update(
    report: UploadReport,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<UploadReport>>;

  findById(id: UploadReportId): Promise<RepositoryResult<UploadReport | null>>;
}
