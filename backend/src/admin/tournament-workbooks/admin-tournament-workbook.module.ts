import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";

import { loadHttpServerConfig } from "../../config/http-server.config";
import { PersistenceModule } from "../../repositories";
import { AdministratorSecurityModule } from "../security";
import { AdminTournamentSetupModule } from "../tournament-setup";
import { AdministratorWebExceptionFilter } from "../web/admin-web.errors";
import { AdminTournamentWorkbookService } from "./admin-tournament-workbook.service";
import { AdminTournamentWorkbooksController } from "./admin-tournament-workbooks.controller";
import { AdminWebTournamentWorkbooksController } from "./admin-web-tournament-workbooks.controller";
import { AdministratorMultipartCsrfVerifier } from "./administrator-multipart-csrf.verifier";
import { AdministratorMultipartOriginGuard } from "./administrator-multipart-csrf.verifier";

@Module({
  imports: [
    AdministratorSecurityModule,
    AdminTournamentSetupModule,
    PersistenceModule,
    MulterModule.registerAsync({
      useFactory: () => ({
        limits: {
          fileSize: loadHttpServerConfig().scorebookUploadLimitBytes,
          files: 1,
          fields: 1,
          parts: 2,
          fieldNameSize: 100,
          fieldSize: 1_024
        }
      })
    })
  ],
  controllers: [
    AdminTournamentWorkbooksController,
    AdminWebTournamentWorkbooksController
  ],
  providers: [
    AdminTournamentWorkbookService,
    AdministratorMultipartOriginGuard,
    AdministratorMultipartCsrfVerifier,
    AdministratorWebExceptionFilter
  ],
  exports: [AdminTournamentWorkbookService]
})
export class AdminTournamentWorkbookModule {}
