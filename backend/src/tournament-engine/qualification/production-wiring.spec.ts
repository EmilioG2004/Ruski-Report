import { Test, TestingModule } from "@nestjs/testing";

import { PersistenceModule } from "../../repositories";
import {
  REALTIME_EVENT_BROADCASTER,
  RealtimeEventBroadcaster
} from "../../realtime";
import {
  CANONICAL_PROJECTION_ACTIVATION_LISTENER,
  CanonicalProjectionActivationListener,
  CanonicalProjectionActivationResult,
  PostgresProjectionRepository,
  PostgresTournamentProgressionRepository,
  PostgresTournamentSetupRepository
} from "../persistence";
import { PostgresWorkbookReconciliationRepository } from "../workbook";

describe("production projection and realtime wiring", () => {
  let moduleRef: TestingModule;
  const broadcaster: RealtimeEventBroadcaster = {
    broadcast: jest.fn()
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PersistenceModule] })
      .overrideProvider(REALTIME_EVENT_BROADCASTER)
      .useValue(broadcaster)
      .compile();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("injects projection refresh and activation into every canonical writer", () => {
    const projections = moduleRef.get(PostgresProjectionRepository);
    const listener = moduleRef.get<CanonicalProjectionActivationListener>(
      CANONICAL_PROJECTION_ACTIVATION_LISTENER
    );
    const repositories = [
      moduleRef.get(PostgresTournamentSetupRepository),
      moduleRef.get(PostgresTournamentProgressionRepository),
      moduleRef.get(PostgresWorkbookReconciliationRepository)
    ];

    for (const repository of repositories) {
      const wired = repository as unknown as ProjectedRepository;
      expect(wired.projections).toBe(projections);
      expect(wired.projectionListener).toBe(listener);
    }
  });

  it("publishes one version-pinned tournament event before changed matches", () => {
    const listener = moduleRef.get<CanonicalProjectionActivationListener>(
      CANONICAL_PROJECTION_ACTIVATION_LISTENER
    );
    listener({
      tournamentId: "00000000-0000-4000-8000-000000000001",
      publicTournamentId: "qualification-2027",
      lifecycle: "pod_play",
      rowVersion: 9,
      projectionVersion: 4,
      changedMatchIds: ["match-one", "match-two"],
      sourceDigest: "a".repeat(64)
    } as unknown as CanonicalProjectionActivationResult);

    expect(broadcaster.broadcast).toHaveBeenCalledTimes(3);
    expect(broadcaster.broadcast).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: "tournament.updated",
      tournamentId: "qualification-2027",
      projectionVersion: 4,
      version: 4
    }));
    expect(broadcaster.broadcast).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: "match.updated",
      tournamentId: "qualification-2027",
      matchId: "match-one",
      projectionVersion: 4,
      version: 4
    }));
    expect(broadcaster.broadcast).toHaveBeenNthCalledWith(3, expect.objectContaining({
      type: "match.updated",
      tournamentId: "qualification-2027",
      matchId: "match-two",
      projectionVersion: 4,
      version: 4
    }));
  });
});

interface ProjectedRepository {
  projections?: PostgresProjectionRepository;
  projectionListener?: CanonicalProjectionActivationListener;
}
