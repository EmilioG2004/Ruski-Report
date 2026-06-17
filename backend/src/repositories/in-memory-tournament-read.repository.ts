import { Injectable } from "@nestjs/common";

import {
  MatchDetail,
  MatchSummary,
  Tournament,
  TournamentSummary
} from "../domain";
import { sampleMatchDetail, sampleTournament } from "../sample-data";
import { repositorySuccess, RepositoryResult } from "./repository-result";
import {
  ActiveTournamentQuery,
  TournamentReadRepository
} from "./tournament-read-repository";

@Injectable()
export class InMemoryTournamentReadRepository
  implements TournamentReadRepository
{
  constructor(
    private readonly tournaments: Tournament[] = [sampleTournament],
    private readonly matches: MatchDetail[] = [sampleMatchDetail]
  ) {}

  async findActiveTournament(
    query?: ActiveTournamentQuery
  ): Promise<RepositoryResult<TournamentSummary | null>> {
    const tournament =
      this.tournaments.find((candidate) => {
        const gameTypeMatches =
          query?.gameType === undefined || candidate.gameType === query.gameType;
        const yearMatches =
          query?.year === undefined || candidate.year === query.year;

        return candidate.status === "active" && gameTypeMatches && yearMatches;
      }) ?? null;

    return repositorySuccess(
      tournament === null ? null : clone(toTournamentSummary(tournament))
    );
  }

  async findTournamentById(
    tournamentId: string
  ): Promise<RepositoryResult<Tournament | null>> {
    const tournament =
      this.tournaments.find((candidate) => candidate.id === tournamentId) ?? null;

    return repositorySuccess(tournament === null ? null : clone(tournament));
  }

  async findMatchesByTournamentId(
    tournamentId: string
  ): Promise<RepositoryResult<MatchSummary[]>> {
    const tournament = this.tournaments.find(
      (candidate) => candidate.id === tournamentId
    );

    return repositorySuccess(clone(tournament?.matchSummaries ?? []));
  }

  async findMatchDetail(
    matchId: string
  ): Promise<RepositoryResult<MatchDetail | null>> {
    const match =
      this.matches.find((candidate) => candidate.id === matchId) ?? null;

    return repositorySuccess(match === null ? null : clone(match));
  }
}

function toTournamentSummary(tournament: Tournament): TournamentSummary {
  return {
    id: tournament.id,
    year: tournament.year,
    name: tournament.name,
    gameType: tournament.gameType,
    status: tournament.status,
    format: tournament.format,
    activeMatchIds: tournament.activeMatchIds,
    featuredMatchIds: tournament.featuredMatchIds,
    metadata: tournament.metadata,
    version: tournament.version,
    updatedAt: tournament.updatedAt
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
