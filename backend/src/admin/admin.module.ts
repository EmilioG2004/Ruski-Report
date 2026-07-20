import { Module } from "@nestjs/common";

import {
  GamePluginRegistry,
  ruskiGamePlugin
} from "../games";
import {
  PersistenceModule
} from "../repositories";
import { RealtimeModule } from "../realtime";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AdminScorebookController } from "./admin-scorebook.controller";
import { AdminScorebookService } from "./admin-scorebook.service";

@Module({
  imports: [PersistenceModule, RealtimeModule],
  controllers: [AdminScorebookController],
  providers: [
    AdminAuthGuard,
    AdminScorebookService,
    {
      provide: GamePluginRegistry,
      useFactory: () => new GamePluginRegistry([ruskiGamePlugin])
    }
  ],
  exports: [AdminScorebookService]
})
export class AdminModule {}
