import { GameDefinition, GameType } from "../domain";
import { RepositoryResult } from "../repositories";

export const GAME_DEFINITION_REPOSITORY = Symbol("GAME_DEFINITION_REPOSITORY");

export interface GameDefinitionRepository {
  findAll(): Promise<RepositoryResult<GameDefinition[]>>;
  findByGameType(
    gameType: GameType
  ): Promise<RepositoryResult<GameDefinition | null>>;
}
