import { Module } from "@nestjs/common";

import { PersistenceModule } from "../../repositories";
import { AdministratorSecurityModule } from "../security";
import { AdminTournamentSetupValidator } from "./admin-tournament-setup.validator";
import { AdminTournamentSetupService } from "./admin-tournament-setup.service";
import { AdminTournamentsController } from "./admin-tournaments.controller";

@Module({
  imports: [AdministratorSecurityModule, PersistenceModule],
  controllers: [AdminTournamentsController],
  providers: [AdminTournamentSetupService, AdminTournamentSetupValidator],
  exports: [AdminTournamentSetupService]
})
export class AdminTournamentSetupModule {}
