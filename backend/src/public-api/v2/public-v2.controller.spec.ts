import { AppError } from "../../errors";
import {
  matchEnvelope,
  matchListEnvelope,
  tournamentEnvelope,
  V2_TOURNAMENT_ID
} from "./public-v2.fixture";
import { PublicV2Controller } from "./public-v2.controller";
import { PublicV2Service } from "./public-v2.service";

describe("PublicV2Controller", () => {
  it("delegates all frozen routes and treats an omitted version as active", async () => {
    const tournament = tournamentEnvelope();
    const matches = matchListEnvelope();
    const match = matchEnvelope();
    const service = serviceStub();
    service.listActiveTournaments.mockResolvedValue({
      contractVersion: 2,
      tournaments: []
    });
    service.listHistoricalTournaments.mockResolvedValue({
      contractVersion: 2,
      tournaments: []
    });
    service.getTournament.mockResolvedValue(tournament);
    service.getTournamentMatches.mockResolvedValue(matches);
    service.getMatch.mockResolvedValue(match);
    const controller = new PublicV2Controller(service);

    await expect(controller.listActiveTournaments()).resolves.toEqual({
      contractVersion: 2,
      tournaments: []
    });
    await expect(controller.listHistoricalTournaments()).resolves.toEqual({
      contractVersion: 2,
      tournaments: []
    });
    await expect(controller.getTournament(V2_TOURNAMENT_ID)).resolves.toBe(tournament);
    await expect(controller.getTournamentMatches(V2_TOURNAMENT_ID)).resolves.toBe(matches);
    await expect(controller.getMatch("match-1")).resolves.toBe(match);
    expect(service.getTournament).toHaveBeenCalledWith(V2_TOURNAMENT_ID, undefined);
    expect(service.getTournamentMatches).toHaveBeenCalledWith(
      V2_TOURNAMENT_ID,
      undefined
    );
    expect(service.getMatch).toHaveBeenCalledWith("match-1", undefined);
  });

  it("passes a pinned positive safe integer to the service", async () => {
    const service = serviceStub();
    service.getTournament.mockResolvedValue(tournamentEnvelope());
    const controller = new PublicV2Controller(service);

    await controller.getTournament(V2_TOURNAMENT_ID, "42");

    expect(service.getTournament).toHaveBeenCalledWith(V2_TOURNAMENT_ID, 42);
  });

  it.each(["", "0", "-1", "1.5", "1e2", " 2", "9007199254740992"])(
    "rejects invalid projectionVersion '%s' with the stable public error",
    async (value) => {
      const controller = new PublicV2Controller(serviceStub());

      await expect(
        Promise.resolve().then(() =>
          controller.getTournament(V2_TOURNAMENT_ID, value)
        )
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        statusCode: 400,
        details: [
          expect.objectContaining({
            code: "PROJECTION_VERSION_INVALID",
            path: "projectionVersion"
          })
        ]
      } satisfies Partial<AppError>);
    }
  );
});

function serviceStub(): jest.Mocked<PublicV2Service> {
  return {
    listActiveTournaments: jest.fn(),
    listHistoricalTournaments: jest.fn(),
    getTournament: jest.fn(),
    getTournamentMatches: jest.fn(),
    getMatch: jest.fn()
  } as unknown as jest.Mocked<PublicV2Service>;
}
