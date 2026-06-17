import { Module } from "@nestjs/common";

import {
  GAME_DEFINITION_REPOSITORY,
  InMemoryGameDefinitionRepository
} from "../games";
import {
  InMemoryTournamentReadRepository,
  TOURNAMENT_READ_REPOSITORY
} from "../repositories";
import { GamesController } from "./games.controller";
import { GamesService } from "./games.service";
import { MatchesController } from "./matches.controller";
import { MatchesService } from "./matches.service";
import { TournamentsController } from "./tournaments.controller";
import { TournamentsService } from "./tournaments.service";

@Module({
  controllers: [GamesController, TournamentsController, MatchesController],
  providers: [
    GamesService,
    TournamentsService,
    MatchesService,
    {
      provide: GAME_DEFINITION_REPOSITORY,
      useClass: InMemoryGameDefinitionRepository
    },
    {
      provide: TOURNAMENT_READ_REPOSITORY,
      useClass: InMemoryTournamentReadRepository
    }
  ],
  exports: [GamesService, TournamentsService, MatchesService]
})
export class PublicApiModule {}
