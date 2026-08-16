import { Module } from "@nestjs/common";

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

@Module({
  imports: [AdminAuthModule, PersistenceModule, RealtimeModule],
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
