import { Module } from "@nestjs/common";

import {
  GAME_DEFINITION_REPOSITORY,
  InMemoryGameDefinitionRepository
} from "../games";
import {
  COMMENT_REPOSITORY,
  InMemoryCommentRepository,
  InMemoryTournamentReadRepository,
  TOURNAMENT_READ_REPOSITORY
} from "../repositories";
import { CommentsController } from "./comments.controller";
import { CommentsService } from "./comments.service";
import { GamesController } from "./games.controller";
import { GamesService } from "./games.service";
import { MatchesController } from "./matches.controller";
import { MatchesService } from "./matches.service";
import { TournamentsController } from "./tournaments.controller";
import { TournamentsService } from "./tournaments.service";

@Module({
  controllers: [
    GamesController,
    TournamentsController,
    MatchesController,
    CommentsController
  ],
  providers: [
    GamesService,
    TournamentsService,
    MatchesService,
    CommentsService,
    {
      provide: GAME_DEFINITION_REPOSITORY,
      useClass: InMemoryGameDefinitionRepository
    },
    {
      provide: TOURNAMENT_READ_REPOSITORY,
      useClass: InMemoryTournamentReadRepository
    },
    {
      provide: COMMENT_REPOSITORY,
      useClass: InMemoryCommentRepository
    }
  ],
  exports: [GamesService, TournamentsService, MatchesService, CommentsService]
})
export class PublicApiModule {}
