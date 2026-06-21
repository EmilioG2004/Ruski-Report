import { Module } from "@nestjs/common";

import {
  GamePluginRegistry,
  ruskiGamePlugin
} from "../games";
import {
  InMemoryTournamentSnapshotRepository,
  InMemoryTransactionManager,
  InMemoryUploadReportRepository,
  TOURNAMENT_SNAPSHOT_REPOSITORY,
  TRANSACTION_MANAGER,
  UPLOAD_REPORT_REPOSITORY
} from "../repositories";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AdminScorebookController } from "./admin-scorebook.controller";
import { AdminScorebookService } from "./admin-scorebook.service";

@Module({
  controllers: [AdminScorebookController],
  providers: [
    AdminAuthGuard,
    AdminScorebookService,
    {
      provide: GamePluginRegistry,
      useFactory: () => new GamePluginRegistry([ruskiGamePlugin])
    },
    {
      provide: UPLOAD_REPORT_REPOSITORY,
      useClass: InMemoryUploadReportRepository
    },
    {
      provide: TOURNAMENT_SNAPSHOT_REPOSITORY,
      useClass: InMemoryTournamentSnapshotRepository
    },
    {
      provide: TRANSACTION_MANAGER,
      useClass: InMemoryTransactionManager
    }
  ],
  exports: [AdminScorebookService]
})
export class AdminModule {}
