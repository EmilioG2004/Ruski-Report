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
  CommentBodyNormalizer,
  ConfiguredCommentModerationPolicy,
  DefaultCommentSubmissionPolicy
} from "../comments";
import { CommentsConfig } from "../config/comments.config";
import {
  GameDefinitionRepository,
  InMemoryGameDefinitionRepository
} from "../games";
import {
  CommentRepository,
  InMemoryCommentRepository,
  InMemoryTransactionManager,
  InMemoryTournamentReadRepository,
  InMemoryUserBlockRepository,
  repositorySuccess,
  RepositoryResult,
  TournamentReadRepository
} from "../repositories";
import { AppError } from "../errors";
import { AppLogger } from "../logging";
import { RealtimeUpdatePublisher } from "../realtime";
import { CommentsService } from "./comments.service";
import { GamesService } from "./games.service";
import { MatchesService } from "./matches.service";
import { TournamentsService } from "./tournaments.service";
import { PublicProjectionReadRepository } from
  "./v2/public-projection-read.repository";

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
    const service = createCommentsService(
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

  it("filters blocked authors only for the authenticated viewer", async () => {
    const blocks = new InMemoryUserBlockRepository();
    const comments = new InMemoryCommentRepository((viewer, author) =>
      blocks.isBlocked(viewer, author)
    );
    const service = createCommentsService(
      comments,
      new InMemoryTournamentReadRepository(),
      createRealtimeUpdates()
    );
    const first = await comments.create({
      matchId: "match-2026-001",
      author: {
        kind: "account",
        displayName: "Blocked Player",
        userId: "user-blocked"
      },
      body: "Hidden for one viewer."
    });
    const second = await comments.create({
      matchId: "match-2026-001",
      author: {
        kind: "account",
        displayName: "Visible Player",
        userId: "user-visible"
      },
      body: "Visible for everyone."
    });
    if (!first.ok || !second.ok) {
      throw new Error("Unable to seed comments.");
    }

    await blocks.block(
      {
        blockerUserId: authenticatedPrincipal.userId,
        blockedUser: {
          userId: "user-blocked",
          displayName: "Blocked Player"
        },
        createdAt: "2026-07-23T12:00:00.000Z"
      },
      {
        id: "transaction-1",
        startedAt: "2026-07-23T12:00:00.000Z"
      }
    );

    await expect(
      service.getMatchComments("match-2026-001")
    ).resolves.toHaveLength(2);
    await expect(
      service.getMatchComments("match-2026-001", authenticatedPrincipal)
    ).resolves.toEqual([second.value]);

    await blocks.unblock(
      authenticatedPrincipal.userId,
      "user-blocked"
    );

    await expect(
      service.getMatchComments("match-2026-001", authenticatedPrincipal)
    ).resolves.toEqual([first.value, second.value]);
  });

  it("derives the comment author from the authenticated principal", async () => {
    const service = createCommentsService(
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
    const service = createCommentsService(
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
      statusCode: 400,
      details: [
        expect.objectContaining({
          code: "COMMENT_BODY_REQUIRED",
          path: "body"
        })
      ]
    } satisfies Partial<AppError>);

    await expect(
      service.createMatchComment(
        "match-2026-001",
        { body: "a".repeat(501) },
        authenticatedPrincipal
      )
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      statusCode: 400,
      details: [
        expect.objectContaining({
          code: "COMMENT_BODY_TOO_LONG",
          metadata: { maximumBodyLength: 500 }
        })
      ]
    } satisfies Partial<AppError>);
  });

  it("normalizes comment bodies before persistence", async () => {
    const service = createCommentsService(
      new InMemoryCommentRepository(),
      new InMemoryTournamentReadRepository(),
      createRealtimeUpdates()
    );

    const comment = await service.createMatchComment(
      "match-2026-001",
      { body: "  Ｇｒｅａｔ\tmatch.\r\nNice!  " },
      authenticatedPrincipal
    );

    expect(comment.body).toBe("Great match.\nNice!");
  });

  it("rejects prohibited content without persisting, publishing, or logging it", async () => {
    const comments = new InMemoryCommentRepository();
    const realtimeUpdates = createRealtimeUpdates();
    const logger = createLogger();
    const service = createCommentsService(
      comments,
      new InMemoryTournamentReadRepository(),
      realtimeUpdates,
      logger
    );
    const unsafeBody = "BLOCKED...PHRASE";

    await expect(
      service.createMatchComment(
        "match-2026-001",
        { body: unsafeBody },
        authenticatedPrincipal
      )
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      statusCode: 422,
      details: [
        expect.objectContaining({
          code: "COMMENT_CONTENT_NOT_ALLOWED",
          path: "body"
        })
      ]
    });

    const stored = await comments.findByMatchId("match-2026-001");
    expect(stored).toEqual(repositorySuccess([]));
    expect(realtimeUpdates.publishCommentsUpdated).not.toHaveBeenCalled();
    expect(logger.warning).toHaveBeenCalledWith(
      "Comment submission rejected.",
      expect.objectContaining({
        matchId: "match-2026-001",
        metadata: expect.objectContaining({
          decision: "rejected",
          reason: "content_not_allowed",
          ruleId: "blocked-phrase-1"
        })
      })
    );
    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain(unsafeBody);
  });

  it("rejects spam-like and recently repeated comments with stable errors", async () => {
    const realtimeUpdates = createRealtimeUpdates();
    const service = createCommentsService(
      new InMemoryCommentRepository(),
      new InMemoryTournamentReadRepository(),
      realtimeUpdates
    );

    await expect(
      service.createMatchComment(
        "match-2026-001",
        { body: "Nooooooooo" },
        authenticatedPrincipal
      )
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: [
        expect.objectContaining({ code: "COMMENT_SPAM_DETECTED" })
      ]
    });

    await service.createMatchComment(
      "match-2026-001",
      { body: "Great   match." },
      authenticatedPrincipal
    );
    await expect(
      service.createMatchComment(
        "match-2026-001",
        { body: "  GREAT...MATCH  " },
        authenticatedPrincipal
      )
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409,
      details: [
        expect.objectContaining({ code: "COMMENT_RECENTLY_REPEATED" })
      ]
    });
    expect(realtimeUpdates.publishCommentsUpdated).toHaveBeenCalledTimes(1);
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
    const service = createCommentsService(
      new InMemoryCommentRepository(),
      new EmptyTournamentReadRepository(),
      createRealtimeUpdates()
    );

    await expect(service.getMatchComments("missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404
    } satisfies Partial<AppError>);
  });

  it("accepts comments for a match in the active canonical projection", async () => {
    const projections = emptyPublicProjections();
    projections.findVisibleMatchReference = jest.fn().mockResolvedValue({
      matchId: "match-2027-001",
      tournamentId: "tournament-2027",
      projectionVersion: 3
    });
    const realtime = createRealtimeUpdates();
    const service = createCommentsService(
      new InMemoryCommentRepository(),
      new EmptyTournamentReadRepository(),
      realtime,
      createLogger(),
      projections
    );

    const comment = await service.createMatchComment(
      "match-2027-001",
      { body: "Canonical match comment." },
      authenticatedPrincipal
    );

    expect(comment.matchId).toBe("match-2027-001");
    expect(realtime.publishCommentsUpdated).toHaveBeenCalledWith({
      tournamentId: "tournament-2027",
      matchId: "match-2027-001",
      projectionVersion: 3,
      metadata: { commentId: comment.id }
    });
  });
});

function createRealtimeUpdates(): jest.Mocked<RealtimeUpdatePublisher> {
  return {
    publishTournamentUpdated: jest.fn(),
    publishMatchUpdated: jest.fn(),
    publishCommentsUpdated: jest.fn()
  } as unknown as jest.Mocked<RealtimeUpdatePublisher>;
}

const commentsConfig: CommentsConfig = {
  maximumBodyLength: 500,
  duplicateWindowSeconds: 300,
  maximumLinks: 2,
  maximumRepeatedCharacterRun: 8,
  maximumRepeatedTokenCount: 4,
  moderationRulesPath: "unused-in-unit-tests.json"
};

function createCommentsService(
  comments: CommentRepository,
  tournaments: TournamentReadRepository,
  realtimeUpdates: RealtimeUpdatePublisher,
  logger: AppLogger = createLogger(),
  projections: PublicProjectionReadRepository = emptyPublicProjections()
): CommentsService {
  const normalizer = new CommentBodyNormalizer();
  const moderation = new ConfiguredCommentModerationPolicy(
    { blockedPhrases: ["blocked phrase"] },
    normalizer
  );

  return new CommentsService(
    comments,
    tournaments,
    projections,
    new InMemoryTransactionManager(),
    realtimeUpdates,
    new DefaultCommentSubmissionPolicy(
      commentsConfig,
      normalizer,
      moderation
    ),
    commentsConfig,
    logger
  );
}

function emptyPublicProjections(): jest.Mocked<PublicProjectionReadRepository> {
  return {
    listActiveTournaments: jest.fn().mockResolvedValue([]),
    listHistoricalTournaments: jest.fn().mockResolvedValue([]),
    hasPublicTournament: jest.fn().mockResolvedValue(false),
    findTournament: jest.fn().mockResolvedValue(null),
    findTournamentMatches: jest.fn().mockResolvedValue(null),
    findMatch: jest.fn().mockResolvedValue(null),
    findVisibleMatchReference: jest.fn().mockResolvedValue(null)
  };
}

function createLogger(): jest.Mocked<AppLogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn()
  };
}
