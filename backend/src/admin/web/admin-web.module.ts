import { Module } from "@nestjs/common";

import { AdministratorSecurityModule } from "../security";
import { AdminTournamentSetupModule } from "../tournament-setup";
import { AdminTournamentProgressionModule } from "../tournament-progression";
import { AdminWebAssetsController } from "./admin-web-assets.controller";
import { AdminWebAuthenticationController } from "./admin-web-auth.controller";
import { AdministratorWebExceptionFilter } from "./admin-web.errors";
import { AdminWebTournamentsController } from "./admin-web-tournaments.controller";
import { AdminWebTournamentProgressionController } from "./progression";

@Module({
  imports: [
    AdministratorSecurityModule,
    AdminTournamentProgressionModule,
    AdminTournamentSetupModule
  ],
  controllers: [
    AdminWebAssetsController,
    AdminWebAuthenticationController,
    AdminWebTournamentsController,
    AdminWebTournamentProgressionController
  ],
  providers: [AdministratorWebExceptionFilter]
})
export class AdminWebModule {}
