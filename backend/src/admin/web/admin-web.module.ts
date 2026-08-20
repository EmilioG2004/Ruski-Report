import { Module } from "@nestjs/common";

import { AdministratorSecurityModule } from "../security";
import { AdminTournamentSetupModule } from "../tournament-setup";
import { AdminWebAssetsController } from "./admin-web-assets.controller";
import { AdminWebAuthenticationController } from "./admin-web-auth.controller";
import { AdministratorWebExceptionFilter } from "./admin-web.errors";
import { AdminWebTournamentsController } from "./admin-web-tournaments.controller";

@Module({
  imports: [AdministratorSecurityModule, AdminTournamentSetupModule],
  controllers: [
    AdminWebAssetsController,
    AdminWebAuthenticationController,
    AdminWebTournamentsController
  ],
  providers: [AdministratorWebExceptionFilter]
})
export class AdminWebModule {}
