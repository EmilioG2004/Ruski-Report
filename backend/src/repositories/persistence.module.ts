import { Module } from "@nestjs/common";

import { loadDatabaseConfig } from "../config/database.config";
import {
  DATABASE_CONFIG,
  PostgresDatabase,
  PostgresTransactionManager
} from "../database";
import {
  PostgresAccountRepository,
  PostgresAuthSessionRepository,
  PostgresCommentReportRepository,
  PostgresCommentRepository,
  PostgresTournamentReadRepository,
  PostgresTournamentSnapshotRepository,
  PostgresUploadReportRepository,
  PostgresUserBlockRepository
} from "./postgres";
import { ACCOUNT_REPOSITORY } from "./account-repository";
import { AUTH_SESSION_REPOSITORY } from "./auth-session-repository";
import { COMMENT_REPOSITORY } from "./comment-repository";
import { COMMENT_REPORT_REPOSITORY } from "./comment-report-repository";
import { TOURNAMENT_READ_REPOSITORY } from "./tournament-read-repository";
import { TOURNAMENT_SNAPSHOT_REPOSITORY } from "./tournament-snapshot-repository";
import { TRANSACTION_MANAGER } from "./transaction";
import { UPLOAD_REPORT_REPOSITORY } from "./upload-report-repository";
import { USER_BLOCK_REPOSITORY } from "./user-block-repository";

const repositoryProviders = [
  {
    provide: ACCOUNT_REPOSITORY,
    useExisting: PostgresAccountRepository
  },
  {
    provide: AUTH_SESSION_REPOSITORY,
    useExisting: PostgresAuthSessionRepository
  },
  {
    provide: COMMENT_REPOSITORY,
    useExisting: PostgresCommentRepository
  },
  {
    provide: COMMENT_REPORT_REPOSITORY,
    useExisting: PostgresCommentReportRepository
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
  },
  {
    provide: USER_BLOCK_REPOSITORY,
    useExisting: PostgresUserBlockRepository
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
    PostgresAccountRepository,
    PostgresAuthSessionRepository,
    PostgresCommentReportRepository,
    PostgresCommentRepository,
    PostgresTournamentReadRepository,
    PostgresTournamentSnapshotRepository,
    PostgresUploadReportRepository,
    PostgresUserBlockRepository,
    ...repositoryProviders
  ],
  exports: [PostgresDatabase, ...repositoryProviders]
})
export class PersistenceModule {}
