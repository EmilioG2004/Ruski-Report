import { Module } from "@nestjs/common";

import { loadDatabaseConfig } from "../config/database.config";
import {
  DATABASE_CONFIG,
  PostgresDatabase,
  PostgresTransactionManager
} from "../database";
import {
  PostgresCommentRepository,
  PostgresTournamentReadRepository,
  PostgresTournamentSnapshotRepository,
  PostgresUploadReportRepository
} from "./postgres";
import { COMMENT_REPOSITORY } from "./comment-repository";
import { TOURNAMENT_READ_REPOSITORY } from "./tournament-read-repository";
import { TOURNAMENT_SNAPSHOT_REPOSITORY } from "./tournament-snapshot-repository";
import { TRANSACTION_MANAGER } from "./transaction";
import { UPLOAD_REPORT_REPOSITORY } from "./upload-report-repository";

const repositoryProviders = [
  {
    provide: COMMENT_REPOSITORY,
    useExisting: PostgresCommentRepository
  },
  {
    provide: TOURNAMENT_READ_REPOSITORY,
    useExisting: PostgresTournamentReadRepository
  },
  {
    provide: TOURNAMENT_SNAPSHOT_REPOSITORY,
    useExisting: PostgresTournamentSnapshotRepository
  },
  {
    provide: TRANSACTION_MANAGER,
    useExisting: PostgresTransactionManager
  },
  {
    provide: UPLOAD_REPORT_REPOSITORY,
    useExisting: PostgresUploadReportRepository
  }
];

@Module({
  providers: [
    {
      provide: DATABASE_CONFIG,
      useFactory: loadDatabaseConfig
    },
    PostgresDatabase,
    PostgresTransactionManager,
    PostgresCommentRepository,
    PostgresTournamentReadRepository,
    PostgresTournamentSnapshotRepository,
    PostgresUploadReportRepository,
    ...repositoryProviders
  ],
  exports: [PostgresDatabase, ...repositoryProviders]
})
export class PersistenceModule {}
