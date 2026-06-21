import {
  GameType,
  ISODateTimeString,
  TournamentId
} from "../domain";
import { ScorebookSource, ValidationResult } from "../games";
import {
  PublishedSnapshotVersion,
  UploadReportStatus
} from "../repositories";

export interface ScorebookUploadResponse {
  uploadId: string;
  gameType: GameType;
  source: ScorebookSource;
  status: UploadReportStatus;
  validation: ValidationResult;
  tournamentId?: TournamentId;
  snapshotVersion?: PublishedSnapshotVersion;
  receivedAt: ISODateTimeString;
  completedAt?: ISODateTimeString;
}
