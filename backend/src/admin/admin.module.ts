import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";

import { loadHttpServerConfig } from "../config/http-server.config";
import {
  GamePluginRegistry,
  ruskiGamePlugin
} from "../games";
import {
  PersistenceModule
} from "../repositories";
import { RealtimeModule } from "../realtime";
import { AdminAuthModule } from "./admin-auth.module";
import { AdminScorebookController } from "./admin-scorebook.controller";
import { AdminScorebookService } from "./admin-scorebook.service";
import { AdministratorSecurityModule } from "./security";
import { AdminTournamentSetupModule } from "./tournament-setup";
import { AdminWebModule } from "./web";

@Module({
  imports: [
    AdminAuthModule,
    AdministratorSecurityModule,
    AdminTournamentSetupModule,
    AdminWebModule,
    MulterModule.registerAsync({
      useFactory: () => ({
        limits: {
          fileSize: loadHttpServerConfig().scorebookUploadLimitBytes,
          files: 1
        }
      })
    }),
    PersistenceModule,
    RealtimeModule
  ],
  controllers: [AdminScorebookController],
  providers: [
    AdminScorebookService,
    {
      provide: GamePluginRegistry,
      useFactory: () => new GamePluginRegistry([ruskiGamePlugin])
    }
  ],
  exports: [AdminScorebookService]
})
export class AdminModule {}
