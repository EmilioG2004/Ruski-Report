import { Inject, Injectable } from "@nestjs/common";

import { MatchSummary, Tournament, TournamentSummary } from "../domain";
import {
  TOURNAMENT_READ_REPOSITORY,
  TournamentReadRepository
} from "../repositories";
import {
  resourceNotFound,
  unwrapRepositoryResult
} from "./repository-result.mapper";

@Injectable()
export class TournamentsService {
  constructor(
    @Inject(TOURNAMENT_READ_REPOSITORY)
    private readonly tournamentReadRepository: TournamentReadRepository
  ) {}

  async getActiveTournament(): Promise<TournamentSummary> {
    const tournament = unwrapRepositoryResult(
      await this.tournamentReadRepository.findActiveTournament(),
      "Unable to load the active tournament."
    );

    if (tournament === null) {
      throw resourceNotFound(
        "Active tournament was not found.",
        "tournament",
        "active"
      );
    }

    return tournament;
  }

  async getTournament(tournamentId: string): Promise<Tournament> {
    const tournament = unwrapRepositoryResult(
      await this.tournamentReadRepository.findTournamentById(tournamentId),
      "Unable to load the tournament."
    );

    if (tournament === null) {
      throw resourceNotFound(
        "Tournament was not found.",
        "tournamentId",
        tournamentId
      );
    }

    return tournament;
  }

  async getTournamentMatches(tournamentId: string): Promise<MatchSummary[]> {
    await this.getTournament(tournamentId);

    return unwrapRepositoryResult(
      await this.tournamentReadRepository.findMatchesByTournamentId(tournamentId),
      "Unable to load tournament matches."
    );
  }
}
