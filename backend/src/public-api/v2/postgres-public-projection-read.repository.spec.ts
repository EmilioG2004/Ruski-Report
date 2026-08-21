import { PostgresDatabase } from "../../database";
import { PostgresPublicProjectionReadRepository } from "./postgres-public-projection-read.repository";
import {
  createPublicMatch,
  createTournament,
  V2_TOURNAMENT_ID
} from "./public-v2.fixture";

describe("PostgresPublicProjectionReadRepository", () => {
  it("discovers zero or many active public tournaments in deterministic order", async () => {
    const first = createTournament();
    const second = {
      ...createTournament(),
      id: "fall-classic-2027",
      name: "Fall Classic"
    };
    const database = databaseStub([
      {
        tournament_public_key: first.id,
        projection_version: "4",
        activated_at: new Date("2027-06-01T12:00:00.000Z"),
        tournament_summary: summary(first)
      },
      {
        tournament_public_key: second.id,
        projection_version: "2",
        activated_at: "2027-05-01T12:00:00.000Z",
        tournament_summary: summary(second)
      }
    ]);
    const repository = new PostgresPublicProjectionReadRepository(database.value);

    await expect(repository.listActiveTournaments()).resolves.toEqual([
      {
        projection: {
          tournamentId: first.id,
          version: 4,
          activatedAt: "2027-06-01T12:00:00.000Z",
          source: "canonical"
        },
        tournament: summary(first)
      },
      {
        projection: {
          tournamentId: second.id,
          version: 2,
          activatedAt: "2027-05-01T12:00:00.000Z",
          source: "canonical"
        },
        tournament: summary(second)
      }
    ]);
    const sql = normalizedSql(database.query.mock.calls[0]?.[0]);
    expect(sql).toContain("payload.visibility = 'public'");
    expect(sql).toContain("'setup_published', 'pod_play', 'seeding_review', 'playoffs'");
    expect(sql).toContain(
      "ORDER BY payload.year DESC, active.activated_at DESC, payload.tournament_public_key"
    );
    expect(sql).not.toContain("engine_tournaments");
  });

  it("excludes private materializations from tournament existence checks", async () => {
    const database = databaseStub([{ present: false }]);
    const repository = new PostgresPublicProjectionReadRepository(database.value);

    await expect(repository.hasPublicTournament("private-tournament"))
      .resolves.toBe(false);
    const sql = normalizedSql(database.query.mock.calls[0]?.[0]);
    expect(sql).toContain("payload.visibility = 'public'");
    expect(sql).toContain("projection.status IN ('active', 'superseded')");
    expect(sql).toContain("projection.activated_at IS NOT NULL");
    expect(database.query.mock.calls[0]?.[1]).toEqual(["private-tournament"]);
  });

  it("reads active tournament detail without joining canonical domain tables", async () => {
    const tournament = createTournament();
    const database = databaseStub([{
      tournament_public_key: tournament.id,
      projection_version: 4,
      activated_at: "2027-06-01T12:00:00.000Z",
      tournament_detail: tournament
    }]);
    const repository = new PostgresPublicProjectionReadRepository(database.value);

    await expect(repository.findTournament(tournament.id)).resolves.toEqual({
      contractVersion: 2,
      projection: {
        tournamentId: tournament.id,
        version: 4,
        activatedAt: "2027-06-01T12:00:00.000Z",
        source: "canonical"
      },
      tournament
    });
    const sql = normalizedSql(database.query.mock.calls[0]?.[0]);
    expect(sql).toContain("engine_active_projection_versions");
    expect(sql).toContain("projection.status = 'active'");
    expect(sql).not.toContain("engine_matches");
    expect(sql).not.toContain("engine_tournaments");
  });

  it("keeps an activated superseded version addressable by its immutable number", async () => {
    const tournament = createTournament();
    const database = databaseStub([{
      tournament_public_key: tournament.id,
      projection_version: "3",
      activated_at: "2027-05-31T12:00:00.000Z",
      tournament_detail: tournament
    }]);
    const repository = new PostgresPublicProjectionReadRepository(database.value);

    await repository.findTournament(tournament.id, 3);

    const [query, values] = database.query.mock.calls[0] ?? [];
    const sql = normalizedSql(query);
    expect(sql).toContain("projection.status IN ('active', 'superseded')");
    expect(sql).toContain("projection.activated_at IS NOT NULL");
    expect(values).toEqual([tournament.id, 3]);
  });

  it("loads a whole tournament match list from one projection-scoped query", async () => {
    const matches = [
      createPublicMatch("pod-match", "final", "complete"),
      { ...createPublicMatch("playoff-match", "scheduled", "not_started"), stage: "playoffs" as const }
    ];
    const database = databaseStub([{
      tournament_public_key: V2_TOURNAMENT_ID,
      projection_version: 4,
      activated_at: "2027-06-01T12:00:00.000Z",
      match_summaries: matches
    }]);
    const repository = new PostgresPublicProjectionReadRepository(database.value);

    await expect(repository.findTournamentMatches(V2_TOURNAMENT_ID, 4))
      .resolves.toMatchObject({
        contractVersion: 2,
        projection: { tournamentId: V2_TOURNAMENT_ID, version: 4 },
        matches
      });
    expect(database.query).toHaveBeenCalledTimes(1);
    const sql = normalizedSql(database.query.mock.calls[0]?.[0]);
    expect(sql).toContain("match.projection_version = payload.projection_version");
    expect(sql).not.toContain("engine_matches");
  });

  it("requires the match and tournament payloads to share one selected version", async () => {
    const match = createPublicMatch("match-1");
    const database = databaseStub([{
      tournament_public_key: V2_TOURNAMENT_ID,
      projection_version: 4,
      activated_at: "2027-06-01T12:00:00.000Z",
      detail_payload: match
    }]);
    const repository = new PostgresPublicProjectionReadRepository(database.value);

    await expect(repository.findMatch(match.id, 4)).resolves.toMatchObject({
      contractVersion: 2,
      projection: { tournamentId: V2_TOURNAMENT_ID, version: 4 },
      match
    });
    const sql = normalizedSql(database.query.mock.calls[0]?.[0]);
    expect(sql).toContain("tournament.projection_version = match.projection_version");
    expect(sql).toContain("selected.projection_version = match.projection_version");
    expect(sql).toContain("tournament.visibility = 'public'");
  });

  it("resolves only an active materialized public match for comment integration", async () => {
    const database = databaseStub([{
      match_public_key: "match-1",
      tournament_public_key: V2_TOURNAMENT_ID,
      projection_version: "4"
    }]);
    const repository = new PostgresPublicProjectionReadRepository(database.value);

    await expect(repository.findVisibleMatchReference("match-1")).resolves.toEqual({
      matchId: "match-1",
      tournamentId: V2_TOURNAMENT_ID,
      projectionVersion: 4
    });
    const sql = normalizedSql(database.query.mock.calls[0]?.[0]);
    expect(sql).toContain("projection.status = 'active'");
    expect(sql).toContain("tournament.visibility = 'public'");
    expect(database.query.mock.calls[0]?.[1]).toEqual(["match-1"]);
  });

  it("does not resolve a match with no active public materialization", async () => {
    const repository = new PostgresPublicProjectionReadRepository(
      databaseStub([]).value
    );

    await expect(repository.findVisibleMatchReference("hidden-match"))
      .resolves.toBeNull();
  });

  it("maps database failures to a stable generic error without SQL leakage", async () => {
    const database = databaseFailure(new Error("relation secret_table does not exist"));
    const repository = new PostgresPublicProjectionReadRepository(database.value);

    await expect(repository.listActiveTournaments()).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      statusCode: 500,
      message: "The public projection could not be loaded.",
      details: []
    });
  });
});

function summary(tournament: ReturnType<typeof createTournament>) {
  return {
    id: tournament.id,
    gameType: tournament.gameType,
    year: tournament.year,
    name: tournament.name,
    lifecycle: tournament.lifecycle
  };
}

function databaseStub(rows: readonly unknown[]) {
  const query = jest.fn().mockResolvedValue({ rows });
  return {
    value: { query } as unknown as PostgresDatabase,
    query
  };
}

function databaseFailure(error: Error) {
  const query = jest.fn().mockRejectedValue(error);
  return {
    value: { query } as unknown as PostgresDatabase,
    query
  };
}

function normalizedSql(value: unknown): string {
  return String(value).replace(/\s+/g, " ").trim();
}
