import { Module } from "@nestjs/common";

import { loadDatabaseConfig } from "../config/database.config";
import {
  DATABASE_CONFIG,
  PostgresDatabase,
  PostgresTransactionManager
} from "../database";
import {
  PostgresCanonicalStatisticRepository,
  PostgresMatchRevisionRepository,
  PostgresMatchWriterRepository,
  PostgresProjectionRepository,
  PostgresRosterRepository,
  PostgresTournamentSetupRepository,
  PostgresTournamentProgressionRepository,
  TournamentEngineTransactionManager
} from "../tournament-engine/persistence";
import { PostgresWorkbookReconciliationRepository } from "../tournament-engine/workbook";
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

const tournamentEngineRepositoryTokens = [
  TournamentEngineTransactionManager,
  PostgresTournamentSetupRepository,
  PostgresRosterRepository,
  PostgresMatchWriterRepository,
  PostgresMatchRevisionRepository,
  PostgresCanonicalStatisticRepository,
  PostgresTournamentProgressionRepository,
  PostgresProjectionRepository,
  PostgresWorkbookReconciliationRepository
];

const tournamentEngineRepositoryProviders = [
  {
    provide: TournamentEngineTransactionManager,
    inject: [PostgresDatabase],
    useFactory: (database: PostgresDatabase) =>
      new TournamentEngineTransactionManager(database)
  },
  {
    provide: PostgresTournamentSetupRepository,
    inject: [PostgresDatabase, TournamentEngineTransactionManager],
    useFactory: (
      database: PostgresDatabase,
      transactions: TournamentEngineTransactionManager
    ) => new PostgresTournamentSetupRepository(database, transactions)
  },
  {
    provide: PostgresRosterRepository,
    inject: [PostgresDatabase, TournamentEngineTransactionManager],
    useFactory: (
      database: PostgresDatabase,
      transactions: TournamentEngineTransactionManager
    ) => new PostgresRosterRepository(database, transactions)
  },
  {
    provide: PostgresMatchWriterRepository,
    inject: [PostgresDatabase, TournamentEngineTransactionManager],
    useFactory: (
      database: PostgresDatabase,
      transactions: TournamentEngineTransactionManager
    ) => new PostgresMatchWriterRepository(database, transactions)
  },
  {
    provide: PostgresCanonicalStatisticRepository,
    inject: [PostgresDatabase],
    useFactory: (database: PostgresDatabase) =>
      new PostgresCanonicalStatisticRepository(database)
  },
  {
    provide: PostgresMatchRevisionRepository,
    inject: [PostgresDatabase, TournamentEngineTransactionManager],
    useFactory: (
      database: PostgresDatabase,
      transactions: TournamentEngineTransactionManager
    ) => new PostgresMatchRevisionRepository(database, transactions)
  },
  {
    provide: PostgresProjectionRepository,
    inject: [PostgresDatabase, TournamentEngineTransactionManager],
    useFactory: (
      database: PostgresDatabase,
      transactions: TournamentEngineTransactionManager
    ) => new PostgresProjectionRepository(database, transactions)
  },
  {
    provide: PostgresTournamentProgressionRepository,
    inject: [PostgresDatabase, TournamentEngineTransactionManager],
    useFactory: (
      database: PostgresDatabase,
      transactions: TournamentEngineTransactionManager
    ) => new PostgresTournamentProgressionRepository(database, transactions)
  },
  {
    provide: PostgresWorkbookReconciliationRepository,
    inject: [
      PostgresDatabase,
      TournamentEngineTransactionManager,
      PostgresMatchWriterRepository,
      PostgresMatchRevisionRepository,
      PostgresCanonicalStatisticRepository,
      PostgresTournamentProgressionRepository
    ],
    useFactory: (
      database: PostgresDatabase,
      transactions: TournamentEngineTransactionManager,
      writers: PostgresMatchWriterRepository,
      revisions: PostgresMatchRevisionRepository,
      statistics: PostgresCanonicalStatisticRepository,
      progression: PostgresTournamentProgressionRepository
    ) => new PostgresWorkbookReconciliationRepository(
      database,
      transactions,
      writers,
      revisions,
      statistics,
      progression
    )
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
    ...tournamentEngineRepositoryProviders,
    ...repositoryProviders
  ],
  exports: [
    PostgresDatabase,
    ...tournamentEngineRepositoryTokens,
    ...repositoryProviders
  ]
})
export class PersistenceModule {}
