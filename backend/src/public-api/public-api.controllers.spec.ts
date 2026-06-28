import {
  Comment,
  GameDefinition,
  MatchDetail,
  MatchSummary,
  Tournament
} from "../domain";
import { sampleMatchDetail, sampleMatchSummary, sampleTournament } from "../sample-data";
import { CommentsController } from "./comments.controller";
import { CommentsService, CreateCommentRequest } from "./comments.service";
import { GamesController } from "./games.controller";
import { GamesService } from "./games.service";
import { MatchesController } from "./matches.controller";
import { MatchesService } from "./matches.service";
import { TournamentsController } from "./tournaments.controller";
import { TournamentsService } from "./tournaments.service";

describe("public API controllers", () => {
  it("delegates supported games reads to the games service", async () => {
    const games: GameDefinition[] = [
      {
        gameType: "ruski",
        displayName: "Ruski",
        phases: [],
        eventTypes: [],
        stats: [],
        scorecardDefinitionId: "ruski-scorecard"
      }
    ];
    const service = {
      listGames: jest.fn<Promise<GameDefinition[]>, []>().mockResolvedValue(games)
    } as unknown as GamesService;
    const controller = new GamesController(service);

    await expect(controller.listGames()).resolves.toBe(games);
    expect(service.listGames).toHaveBeenCalledTimes(1);
  });

  it("delegates tournament reads to the tournaments service", async () => {
    const service = {
      getActiveTournament: jest
        .fn<Promise<Tournament>, []>()
        .mockResolvedValue(sampleTournament),
      getTournament: jest
        .fn<Promise<Tournament>, [string]>()
        .mockResolvedValue(sampleTournament),
      getTournamentMatches: jest
        .fn<Promise<MatchSummary[]>, [string]>()
        .mockResolvedValue([sampleMatchSummary])
    } as unknown as TournamentsService;
    const controller = new TournamentsController(service);

    await expect(controller.getActiveTournament()).resolves.toBe(sampleTournament);
    await expect(controller.getTournament("tournament-2026")).resolves.toBe(
      sampleTournament
    );
    await expect(
      controller.getTournamentMatches("tournament-2026")
    ).resolves.toEqual([sampleMatchSummary]);
    expect(service.getActiveTournament).toHaveBeenCalledTimes(1);
    expect(service.getTournament).toHaveBeenCalledWith("tournament-2026");
    expect(service.getTournamentMatches).toHaveBeenCalledWith("tournament-2026");
  });

  it("delegates match detail reads to the matches service", async () => {
    const service = {
      getMatchDetail: jest
        .fn<Promise<MatchDetail>, [string]>()
        .mockResolvedValue(sampleMatchDetail)
    } as unknown as MatchesService;
    const controller = new MatchesController(service);

    await expect(controller.getMatchDetail("match-2026-001")).resolves.toBe(
      sampleMatchDetail
    );
    expect(service.getMatchDetail).toHaveBeenCalledWith("match-2026-001");
  });

  it("delegates match comment reads and writes to the comments service", async () => {
    const comment: Comment = {
      id: "comment-1",
      matchId: "match-2026-001",
      author: {
        kind: "account",
        displayName: "Alex"
      },
      body: "Great match.",
      createdAt: "2026-06-17T12:00:00.000Z"
    };
    const request: CreateCommentRequest = {
      body: "Great match.",
      author: {
        kind: "account",
        displayName: "Alex",
        userId: "user-1"
      }
    };
    const service = {
      getMatchComments: jest
        .fn<Promise<Comment[]>, [string]>()
        .mockResolvedValue([comment]),
      createMatchComment: jest
        .fn<Promise<Comment>, [string, CreateCommentRequest | null | undefined]>()
        .mockResolvedValue(comment)
    } as unknown as CommentsService;
    const controller = new CommentsController(service);

    await expect(
      controller.getMatchComments("match-2026-001")
    ).resolves.toEqual([comment]);
    await expect(
      controller.createMatchComment("match-2026-001", request)
    ).resolves.toBe(comment);
    expect(service.getMatchComments).toHaveBeenCalledWith("match-2026-001");
    expect(service.createMatchComment).toHaveBeenCalledWith(
      "match-2026-001",
      request
    );
  });
});
