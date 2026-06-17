import { Controller, Get, Param } from "@nestjs/common";

import { MatchSummary, Tournament, TournamentSummary } from "../domain";
import { TournamentsService } from "./tournaments.service";

@Controller("tournaments")
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  @Get("active")
  getActiveTournament(): Promise<TournamentSummary> {
    return this.tournamentsService.getActiveTournament();
  }

  @Get(":tournamentId/matches")
  getTournamentMatches(
    @Param("tournamentId") tournamentId: string
  ): Promise<MatchSummary[]> {
    return this.tournamentsService.getTournamentMatches(tournamentId);
  }

  @Get(":tournamentId")
  getTournament(@Param("tournamentId") tournamentId: string): Promise<Tournament> {
    return this.tournamentsService.getTournament(tournamentId);
  }
}
