import { Module } from "@nestjs/common";

import { PersistenceModule } from "../../repositories";
import { AdministratorSecurityModule } from "../security";
import { AdminTournamentProgressionController } from "./admin-tournament-progression.controller";
import { AdminTournamentProgressionService } from "./admin-tournament-progression.service";

@Module({
  imports: [AdministratorSecurityModule, PersistenceModule],
  controllers: [AdminTournamentProgressionController],
  providers: [AdminTournamentProgressionService],
  exports: [AdminTournamentProgressionService]
})
export class AdminTournamentProgressionModule {}
