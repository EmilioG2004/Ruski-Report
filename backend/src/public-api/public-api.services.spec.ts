import {
  AuthenticatedPrincipal,
  Comment,
  GameDefinition,
  MatchDetail,
  MatchSummary,
  Tournament,
  TournamentSummary
} from "../domain";
import {
  GameDefinitionRepository,
  InMemoryGameDefinitionRepository
} from "../games";
import {
  InMemoryCommentRepository,
  InMemoryTournamentReadRepository,
  repositorySuccess,
  RepositoryResult,
  TournamentReadRepository
} from "../repositories";
import { AppError } from "../errors";
import { RealtimeUpdatePublisher } from "../realtime";
import { CommentsService } from "./comments.service";
import { GamesService } from "./games.service";
import { MatchesService } from "./matches.service";
import { TournamentsService } from "./tournaments.service";

class EmptyTournamentReadRepository implements TournamentReadRepository {
  async findActiveTournament(): Promise<
    RepositoryResult<TournamentSummary | null>
  > {
    return repositorySuccess(null);
  }

  async findTournamentById(): Promise<RepositoryResult<Tournament | null>> {
    return repositorySuccess(null);
  }

  async findMatchesByTournamentId(): Promise<RepositoryResult<MatchSummary[]>> {
    return repositorySuccess([]);
  }

  async findMatchDetail(): Promise<RepositoryResult<MatchDetail | null>> {
    return repositorySuccess(null);
  }
}

class EmptyGameDefinitionRepository implements GameDefinitionRepository {
  async findAll(): Promise<RepositoryResult<GameDefinition[]>> {
    return repositorySuccess([]);
  }

  async findByGameType(): Promise<RepositoryResult<GameDefinition | null>> {
    return repositorySuccess(null);
  }
}

describe("public API services", () => {
  const authenticatedPrincipal: AuthenticatedPrincipal = {
    userId: "user-1",
    displayName: "Alex",
    provider: "local_account",
    sessionId: "session-1",
    expiresAt: "2026-07-30T12:00:00.000Z"
  };

  it("lists supported games", async () => {
    const service = new GamesService(new InMemoryGameDefinitionRepository());

    await expect(service.listGames()).resolves.toMatchObject([
      {
        gameType: "ruski",
        displayName: "Ruski",
        scorecardDefinitionId: "ruski-scorecard"
      }
    ]);
  });

  it("allows an empty supported games list while plugins are added later", async () => {
    const service = new GamesService(new EmptyGameDefinitionRepository());

    await expect(service.listGames()).resolves.toEqual([]);
  });

  it("returns the active tournament as a lightweight summary", async () => {
    const service = new TournamentsService(
      new InMemoryTournamentReadRepository()
    );

    const tournament = await service.getActiveTournament();

    expect(tournament).toMatchObject({
      id: "tournament-2026",
      status: "active",
      gameType: "ruski"
    });
    expect(tournament).not.toHaveProperty("pods");
    expect(tournament).not.toHaveProperty("matchSummaries");
  });

  it("returns tournament detail with pods, teams, standings, and match summaries", async () => {
    const service = new TournamentsService(
      new InMemoryTournamentReadRepository()
    );

    const tournament = await service.getTournament("tournament-2026");

    expect(tournament.pods).toHaveLength(1);
    expect(tournament.teams).toHaveLength(2);
    expect(tournament.standings).toHaveLength(2);
    expect(tournament.matchSummaries).toHaveLength(1);
  });

  it("returns tournament matches as lightweight summaries", async () => {
    const service = new TournamentsService(
      new InMemoryTournamentReadRepository()
    );

    const matches = await service.getTournamentMatches("tournament-2026");

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      id: "match-2026-001",
      tournamentId: "tournament-2026",
      status: "in_progress"
    });
    expect(matches[0]).not.toHaveProperty("scorecard");
    expect(matches[0]).not.toHaveProperty("boxScore");
    expect(matches[0]).not.toHaveProperty("events");
  });

  it("returns match detail with scorecard, rows, box score, events, and phase", async () => {
    const service = new MatchesService(new InMemoryTournamentReadRepository());

    const match = await service.getMatchDetail("match-2026-001");

    expect(match.currentPhase).toMatchObject({
      id: "normal",
      status: "active"
    });
    expect(match.scorecard.definition.id).toBe("ruski-scorecard");
    expect(match.scorecard.rows).toHaveLength(2);
    expect(match.boxScore.rows).toHaveLength(2);
    expect(match.events).toHaveLength(2);
  });

  it("returns comments scoped to a match", async () => {
    const realtimeUpdates = createRealtimeUpdates();
    const service = new CommentsService(
      new InMemoryCommentRepository(),
      new InMemoryTournamentReadRepository(),
      realtimeUpdates
    );

    const created = await service.createMatchComment(
      "match-2026-001",
      { body: "Great match." },
      authenticatedPrincipal
    );
    const comments = await service.getMatchComments("match-2026-001");

    expect(created).toMatchObject({
      matchId: "match-2026-001",
      body: "Great match.",
      author: {
        kind: "account",
        displayName: "Alex",
        userId: "user-1"
      }
    } satisfies Partial<Comment>);
    expect(comments).toEqual([created]);
    expect(realtimeUpdates.publishCommentsUpdated).toHaveBeenCalledWith({
      tournamentId: "tournament-2026",
      matchId: "match-2026-001",
      metadata: {
        commentId: created.id
      }
    });
  });

  it("derives the comment author from the authenticated principal", async () => {
    const service = new CommentsService(
      new InMemoryCommentRepository(),
      new InMemoryTournamentReadRepository(),
      createRealtimeUpdates()
    );

    const request = {
      body: "Great match.",
      author: { kind: "admin", displayName: "Spoofed", userId: "admin-1" }
    };
    const comment = await service.createMatchComment(
      "match-2026-001",
      request,
      authenticatedPrincipal
    );

    expect(comment.author).toEqual({
      kind: "account",
      displayName: "Alex",
      userId: "user-1"
    });
  });

  it("rejects invalid comment bodies", async () => {
    const service = new CommentsService(
      new InMemoryCommentRepository(),
      new InMemoryTournamentReadRepository(),
      createRealtimeUpdates()
    );

    await expect(
      service.createMatchComment("match-2026-001", {
        body: "   "
      }, authenticatedPrincipal)
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      statusCode: 400
    } satisfies Partial<AppError>);
  });

  it("raises not found when a tournament does not exist", async () => {
    const service = new TournamentsService(new EmptyTournamentReadRepository());

    await expect(service.getTournament("missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404
    } satisfies Partial<AppError>);
  });

  it("raises not found when a match does not exist", async () => {
    const service = new MatchesService(new EmptyTournamentReadRepository());

    await expect(service.getMatchDetail("missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404
    } satisfies Partial<AppError>);
  });

  it("raises not found when reading comments for a missing match", async () => {
    const service = new CommentsService(
      new InMemoryCommentRepository(),
      new EmptyTournamentReadRepository(),
      createRealtimeUpdates()
    );

    await expect(service.getMatchComments("missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404
    } satisfies Partial<AppError>);
  });
});

function createRealtimeUpdates(): jest.Mocked<RealtimeUpdatePublisher> {
  return {
    publishTournamentUpdated: jest.fn(),
    publishMatchUpdated: jest.fn(),
    publishCommentsUpdated: jest.fn()
  } as unknown as jest.Mocked<RealtimeUpdatePublisher>;
}
