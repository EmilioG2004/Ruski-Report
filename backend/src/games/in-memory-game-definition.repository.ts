import { Injectable } from "@nestjs/common";

import { GameDefinition, GameType } from "../domain";
import {
  repositorySuccess,
  RepositoryResult
} from "../repositories/repository-result";
import { GameDefinitionRepository } from "./game-definition-repository";
import { ruskiGameDefinition } from "./ruski";

@Injectable()
export class InMemoryGameDefinitionRepository
  implements GameDefinitionRepository
{
  private readonly gameDefinitions: GameDefinition[] = [ruskiGameDefinition];

  async findAll(): Promise<RepositoryResult<GameDefinition[]>> {
    return repositorySuccess(clone(this.gameDefinitions));
  }

  async findByGameType(
    gameType: GameType
  ): Promise<RepositoryResult<GameDefinition | null>> {
    const definition =
      this.gameDefinitions.find((candidate) => candidate.gameType === gameType) ??
      null;

    return repositorySuccess(definition === null ? null : clone(definition));
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
