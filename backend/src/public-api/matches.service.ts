import { Inject, Injectable } from "@nestjs/common";

import { MatchDetail } from "../domain";
import {
  TOURNAMENT_READ_REPOSITORY,
  TournamentReadRepository
} from "../repositories";
import {
  resourceNotFound,
  unwrapRepositoryResult
} from "./repository-result.mapper";

@Injectable()
export class MatchesService {
  constructor(
    @Inject(TOURNAMENT_READ_REPOSITORY)
    private readonly tournamentReadRepository: TournamentReadRepository
  ) {}

  async getMatchDetail(matchId: string): Promise<MatchDetail> {
    const match = unwrapRepositoryResult(
      await this.tournamentReadRepository.findMatchDetail(matchId),
      "Unable to load match detail."
    );

    if (match === null) {
      throw resourceNotFound("Match was not found.", "matchId", matchId);
    }

    return match;
  }
}
