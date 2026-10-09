import { Module } from "@nestjs/common";

import { AuthModule } from "../auth";
import { CommentModerationModule } from "../comments";
import {
  GAME_DEFINITION_REPOSITORY,
  InMemoryGameDefinitionRepository
} from "../games";
import {
  PersistenceModule
} from "../repositories";
import { RealtimeModule } from "../realtime";
import { CommentsController } from "./comments.controller";
import { CommentsService } from "./comments.service";
import { GamesController } from "./games.controller";
import { GamesService } from "./games.service";
import { MatchesController } from "./matches.controller";
import { MatchesService } from "./matches.service";
import { TournamentsController } from "./tournaments.controller";
import { TournamentsService } from "./tournaments.service";
import { PublicV2Module } from "./v2";

@Module({
  imports: [
    AuthModule,
    CommentModerationModule,
    PersistenceModule,
    PublicV2Module,
    RealtimeModule
  ],
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
    }
  ],
  exports: [GamesService, TournamentsService, MatchesService, CommentsService]
})
export class PublicApiModule {}
