import { AppError } from "../../errors";
import {
  CanonicalPublicMatch,
  CanonicalPublicProjectionRef,
  PUBLIC_PROJECTION_CONTRACT_VERSION
} from "../../tournament-engine/public-projection";
import { PublicProjectionReadRepository } from "./public-projection-read.repository";
import {
  createPublicMatch,
  createTournament,
  discoveryItem,
  matchEnvelope,
  matchListEnvelope,
  tournamentEnvelope,
  V2_PROJECTION,
  V2_TOURNAMENT_ID
} from "./public-v2.fixture";
import { PublicV2Service } from "./public-v2.service";

describe("PublicV2Service", () => {
  it("returns the exact zero-tournament discovery envelope", async () => {
    const repository = repositoryStub();
    repository.listActiveTournaments.mockResolvedValue([]);

    await expect(new PublicV2Service(repository).listActiveTournaments())
      .resolves.toEqual({ contractVersion: 2, tournaments: [] });
  });

  it("returns completed and archived tournaments through separate history discovery", async () => {
    const historical = discoveryItem({
      ...createTournament(),
      lifecycle: "completed"
    });
    const repository = repositoryStub();
    repository.listHistoricalTournaments.mockResolvedValue([historical]);

    await expect(new PublicV2Service(repository).listHistoricalTournaments())
      .resolves.toEqual({ contractVersion: 2, tournaments: [historical] });
  });

  it("rejects an active tournament leaked into history discovery", async () => {
    const repository = repositoryStub();
    repository.listHistoricalTournaments.mockResolvedValue([discoveryItem()]);

    await expect(new PublicV2Service(repository).listHistoricalTournaments())
      .rejects.toMatchObject({ code: "INTERNAL_ERROR", statusCode: 500 });
  });

  it("preserves the materialized order for two active same-year tournaments", async () => {
    const newer = discoveryItem();
    const older = discoveryItem(
      { ...createTournament(), id: "fall-classic-2027", name: "Fall Classic" },
      {
        ...V2_PROJECTION,
        tournamentId: "fall-classic-2027",
        activatedAt: "2027-05-01T12:00:00.000Z"
      }
    );
    const repository = repositoryStub();
    repository.listActiveTournaments.mockResolvedValue([newer, older]);

    await expect(new PublicV2Service(repository).listActiveTournaments())
      .resolves.toEqual({
        contractVersion: PUBLIC_PROJECTION_CONTRACT_VERSION,
        tournaments: [newer, older]
      });
  });

  it("returns exact tournament, match-list, and match envelopes", async () => {
    const tournament = tournamentEnvelope();
    const matches = matchListEnvelope();
    const match = matchEnvelope();
    const repository = repositoryStub();
    repository.findTournament.mockResolvedValue(tournament);
    repository.findTournamentMatches.mockResolvedValue(matches);
    repository.findMatch.mockResolvedValue(match);
    const service = new PublicV2Service(repository);

    await expect(service.getTournament(V2_TOURNAMENT_ID)).resolves.toEqual(tournament);
    await expect(service.getTournamentMatches(V2_TOURNAMENT_ID)).resolves.toEqual(matches);
    await expect(service.getMatch("match-1")).resolves.toEqual(match);
  });

  it("keeps a pinned immutable projection readable after the next activation", async () => {
    const pinned = tournamentEnvelope(undefined, {
      ...V2_PROJECTION,
      version: 4
    });
    const repository = repositoryStub();
    repository.findTournament.mockImplementation(async (_id, version) =>
      version === 4 ? pinned : tournamentEnvelope(undefined, {
        ...V2_PROJECTION,
        version: 5
      })
    );
    const service = new PublicV2Service(repository);

    await expect(service.getTournament(V2_TOURNAMENT_ID, 4)).resolves.toBe(pinned);
    expect(repository.findTournament).toHaveBeenCalledWith(V2_TOURNAMENT_ID, 4);
  });

  it.each([
    ["scheduled", "not_started"],
    ["in_progress", "partial"],
    ["final", "complete"],
    ["forfeited", "not_applicable"],
    ["cancelled", "not_applicable"],
    ["postponed", "not_started"],
    ["final", "unrecorded"]
  ] as const)(
    "returns a display-ready %s match with %s score availability",
    async (status, scoreAvailability) => {
      const match = createPublicMatch(`match-${status}-${scoreAvailability}`, status, scoreAvailability);
      const repository = repositoryStub();
      repository.findMatch.mockResolvedValue(matchEnvelope(match));

      const result = await new PublicV2Service(repository).getMatch(match.id);

      expect(result.match.status).toBe(status);
      expect(result.match.scoreAvailability).toBe(scoreAvailability);
      expect(result.match.participants).toEqual([
        expect.objectContaining({
          role: "home",
          team: { id: "team-red", name: "Red Rockets" },
          players: expect.arrayContaining([
            expect.objectContaining({ id: "player-red-1", displayName: "Red One" })
          ])
        }),
        expect.objectContaining({
          role: "away",
          team: { id: "team-blue", name: "Blue Barracudas" },
          players: expect.arrayContaining([
            expect.objectContaining({ id: "player-blue-1", displayName: "Blue One" })
          ])
        })
      ]);
      if (scoreAvailability === "unrecorded") {
        expect(result.match.scorecard).toBeNull();
        expect(result.match.boxScore).toBeNull();
      }
    }
  );

  it("distinguishes an unknown tournament from a missing pinned projection", async () => {
    const unknownRepository = repositoryStub();
    unknownRepository.findTournament.mockResolvedValue(null);
    unknownRepository.hasPublicTournament.mockResolvedValue(false);
    const missingProjectionRepository = repositoryStub();
    missingProjectionRepository.findTournament.mockResolvedValue(null);
    missingProjectionRepository.hasPublicTournament.mockResolvedValue(true);

    await expect(
      new PublicV2Service(unknownRepository).getTournament("unknown", 7)
    ).rejects.toMatchObject(errorDetail("PUBLIC_TOURNAMENT_NOT_FOUND"));
    await expect(
      new PublicV2Service(missingProjectionRepository)
        .getTournament(V2_TOURNAMENT_ID, 7)
    ).rejects.toMatchObject(errorDetail("PUBLIC_PROJECTION_NOT_FOUND"));
  });

  it("returns a stable not-found error when a match is absent from a pinned version", async () => {
    const repository = repositoryStub();
    repository.findMatch.mockResolvedValue(null);

    await expect(
      new PublicV2Service(repository).getMatch("missing-match", 3)
    ).rejects.toMatchObject(errorDetail("PUBLIC_MATCH_NOT_FOUND"));
  });

  it.each([
    ["tournament ID", () => tournamentEnvelope(
      { ...createTournament(), id: "wrong-tournament" }
    )],
    ["tournament projection", () => tournamentEnvelope(undefined, {
      ...V2_PROJECTION,
      tournamentId: "wrong-tournament"
    })],
    ["projection version", () => tournamentEnvelope(undefined, {
      ...V2_PROJECTION,
      version: 9
    })]
  ])("rejects a materialized %s mismatch without exposing payload data", async (_name, fixture) => {
    const repository = repositoryStub();
    repository.findTournament.mockResolvedValue(fixture());

    await expect(
      new PublicV2Service(repository).getTournament(V2_TOURNAMENT_ID, 4)
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      statusCode: 500,
      message: "The public projection could not be loaded.",
      details: []
    } satisfies Partial<AppError>);
  });

  it("rejects a match whose participant identity is not display-ready", async () => {
    const invalid = {
      ...createPublicMatch("match-invalid"),
      participants: [
        {
          ...createPublicMatch("template").participants[0],
          team: { id: "team-red", name: "" }
        },
        createPublicMatch("template").participants[1]
      ]
    } as CanonicalPublicMatch;
    const repository = repositoryStub();
    repository.findMatch.mockResolvedValue(matchEnvelope(invalid));

    await expect(
      new PublicV2Service(repository).getMatch("match-invalid")
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR", statusCode: 500 });
  });

  it("rejects a mixed-version match list as an internal projection invariant", async () => {
    const mismatchedProjection: CanonicalPublicProjectionRef = {
      ...V2_PROJECTION,
      version: 3
    };
    const repository = repositoryStub();
    repository.findTournamentMatches.mockResolvedValue(
      matchListEnvelope(undefined, mismatchedProjection)
    );

    await expect(
      new PublicV2Service(repository).getTournamentMatches(V2_TOURNAMENT_ID, 4)
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR", statusCode: 500 });
  });
});

function repositoryStub(): jest.Mocked<PublicProjectionReadRepository> {
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

function errorDetail(code: string): Partial<AppError> {
  return {
    code: "NOT_FOUND",
    statusCode: 404,
    details: [expect.objectContaining({ code })]
  };
}
