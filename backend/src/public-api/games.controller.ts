import { Controller, Get } from "@nestjs/common";

import { GameDefinition } from "../domain";
import { GamesService } from "./games.service";

@Controller("games")
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get()
  listGames(): Promise<GameDefinition[]> {
    return this.gamesService.listGames();
  }
}
