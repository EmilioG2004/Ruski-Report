import { Controller, Get, Param } from "@nestjs/common";

import { MatchDetail } from "../domain";
import { MatchesService } from "./matches.service";

@Controller("matches")
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get(":matchId")
  getMatchDetail(@Param("matchId") matchId: string): Promise<MatchDetail> {
    return this.matchesService.getMatchDetail(matchId);
  }
}
