import { Inject, Injectable } from "@nestjs/common";

import { GameDefinition } from "../domain";
import {
  GAME_DEFINITION_REPOSITORY,
  GameDefinitionRepository
} from "../games";
import { unwrapRepositoryResult } from "./repository-result.mapper";

@Injectable()
export class GamesService {
  constructor(
    @Inject(GAME_DEFINITION_REPOSITORY)
    private readonly gameDefinitionRepository: GameDefinitionRepository
  ) {}

  async listGames(): Promise<GameDefinition[]> {
    return unwrapRepositoryResult(
      await this.gameDefinitionRepository.findAll(),
      "Unable to load supported games."
    );
  }
}
