import {
  GameType,
  MatchDetail,
  MatchId,
  MatchSummary,
  Tournament,
  TournamentId,
  TournamentSummary
} from "../domain";
import { RepositoryResult } from "./repository-result";

export const TOURNAMENT_READ_REPOSITORY = Symbol(
  "TOURNAMENT_READ_REPOSITORY"
);

export interface ActiveTournamentQuery {
  gameType?: GameType;
  year?: number;
}

export interface TournamentReadRepository {
  findActiveTournament(
    query?: ActiveTournamentQuery
  ): Promise<RepositoryResult<TournamentSummary | null>>;

  findTournamentById(
    tournamentId: TournamentId
  ): Promise<RepositoryResult<Tournament | null>>;

  findMatchesByTournamentId(
    tournamentId: TournamentId
  ): Promise<RepositoryResult<MatchSummary[]>>;

  findMatchDetail(matchId: MatchId): Promise<RepositoryResult<MatchDetail | null>>;
}
