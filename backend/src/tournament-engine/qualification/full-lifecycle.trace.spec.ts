import { PoolClient } from "pg";

import { PostgresDatabase } from "../../database";
import { createPostgresTransactionContext } from
  "../../database/postgres-transaction-context";
import {
  createCanonicalProjectionActivationListener,
  RealtimeEventBroadcaster,
  RealtimeUpdatePublisher
} from "../../realtime";
import {
  generateMirroredBracketTopology,
  resolveBracketAdvancements,
  SINGLE_ELIMINATION_BRACKET_RULES_VERSION
} from "../bracket";
import {
  MatchId,
  MatchRevisionId,
  parseStableUuid,
  PodId,
  TournamentId,
  TournamentLifecycle
} from "../domain";
import {
  CanonicalProjectionActivationResult,
  PostgresTournamentProgressionRepository
} from "../persistence";
import {
  calculateGlobalQualifierSeeds,
  createCalculatedEffectiveSeedPlan,
  GLOBAL_QUALIFIER_SEEDING_RULES_VERSION
} from "../seeding";
import { ScheduledPodMatch } from "../scheduling";
import {
  completeSmallTournamentFixture,
  createTournamentSetupPreview
} from "../setup";
import { calculatePodStandings, POD_STANDINGS_RULES_VERSION } from
  "../standings";
import {
  calculateCanonicalMatchStatistics,
  CanonicalStatisticCalculation,
  CanonicalStatisticMetric,
  CanonicalStatisticRevision
} from "../statistics";

describe("sanitized canonical full-lifecycle continuity", () => {
  it("carries one tournament from published setup through champion projection", async () => {
    const fixture = completeSmallTournamentFixture;
    const tournamentId = fixture.setup.tournamentId;
    const trace = new LifecycleTrace(tournamentId);
    const broadcasts: unknown[] = [];
    const broadcaster: RealtimeEventBroadcaster = {
      broadcast: (event) => broadcasts.push(event)
    };
    const listener = createCanonicalProjectionActivationListener(
      new RealtimeUpdatePublisher(broadcaster)
    );
    let projectionVersion = 0;
    const activate = (changedMatchIds: readonly string[]) => listener({
      tournamentId,
      publicTournamentId: "qualification-lifecycle",
      lifecycle: trace.current,
      rowVersion: trace.length,
      projectionVersion: projectionVersion += 1,
      changedMatchIds,
      sourceDigest: "a".repeat(64)
    } as unknown as CanonicalProjectionActivationResult);

    const setup = createTournamentSetupPreview(
      fixture.configuration,
      fixture.setup,
      1
    );
    expect(setup).toMatchObject({ valid: true, digest: expect.any(String) });
    expect(setup.matches).toHaveLength(2);
    trace.advance("draft_setup", "setup_published");
    activate(setup.matches.map((match) => match.id));
    trace.advance("setup_published", "pod_play");

    const podCalculations = setup.matches.map((match, podIndex) => {
      const original = statisticsFor(match, podIndex === 0 ? 5 : 7, 4, 10 + podIndex);
      const active = podIndex === 0
        ? statisticsFor(match, 6, 4, 20)
        : original;
      if (podIndex === 0) {
        expect(active.revision.matchId).toBe(original.revision.matchId);
        expect(active.revision.revisionId).not.toBe(original.revision.revisionId);
        expect(active.calculation.inputDigest).not.toBe(
          original.calculation.inputDigest
        );
      }
      const standings = calculatePodStandings({
        tournamentId,
        podId: match.podId,
        rulesVersion: POD_STANDINGS_RULES_VERSION,
        gamesPerPair: 1,
        qualifiersPerPod: 1,
        teams: match.participantTeamIds.map((teamId, index) => ({
          teamId,
          initialSeed: index + 1
        })),
        matches: [{
          matchId: match.id,
          revisionId: parseStableUuid(active.revision.revisionId, "match_revision"),
          statisticRunId: uuid(7_000 + podIndex),
          statisticInputDigest: active.calculation.inputDigest,
          status: "final",
          scoreAvailability: "complete",
          teams: match.participantTeamIds.map((teamId, index) => ({
            teamId,
            result: index === 0 ? "win" as const : "loss" as const,
            score: metric(active.calculation, teamId, "cups_scored"),
            makes: metric(active.calculation, teamId, "makes"),
            attempts: metric(active.calculation, teamId, "attempts"),
            cupsScored: metric(active.calculation, teamId, "cups_scored"),
            cupsAgainst: metric(active.calculation, teamId, "cups_against")
          })) as unknown as readonly [
            {
              teamId: typeof match.participantTeamIds[0];
              result: "win";
              score: number;
              makes: number;
              attempts: number;
              cupsScored: number;
              cupsAgainst: number;
            },
            {
              teamId: typeof match.participantTeamIds[1];
              result: "loss";
              score: number;
              makes: number;
              attempts: number;
              cupsScored: number;
              cupsAgainst: number;
            }
          ]
        }]
      });
      expect(standings.status).toBe("finalizable");
      return { match, standings };
    });
    activate(setup.matches.map((match) => match.id));

    trace.advance("pod_play", "seeding_review");
    const seeds = calculateGlobalQualifierSeeds({
      tournamentId,
      seedCalculationId: uuid(8_000),
      rulesVersion: GLOBAL_QUALIFIER_SEEDING_RULES_VERSION,
      qualifiersPerPod: 1,
      qualifiers: podCalculations.flatMap(({ match, standings }) =>
        standings.rows.filter((row) => row.qualified).map((row) => ({
          teamId: row.teamId,
          podId: match.podId,
          podRank: requireNumber(row.rank),
          wins: row.wins,
          losses: row.losses,
          cupDifferential: row.cupDifferential,
          makes: row.makes,
          attempts: row.attempts,
          shootingPercentage: row.shootingPercentage
        })))
    });
    expect(seeds.status).toBe("complete");
    expect(seeds.rows).toHaveLength(2);
    const effectiveSeeds = createCalculatedEffectiveSeedPlan(seeds);
    activate([]);

    const topology = generateMirroredBracketTopology({
      tournamentId,
      rulesVersion: SINGLE_ELIMINATION_BRACKET_RULES_VERSION,
      bracketSize: 2,
      allowByes: false,
      effectiveSeedPlan: effectiveSeeds
    });
    let bracket = resolveBracketAdvancements({ topology, activeMatches: [] });
    const final = bracket.rounds[0]?.matches[0];
    if (final?.matchInstance === null || final === undefined) {
      throw new Error("Expected a playable sanitized championship.");
    }
    trace.advance("seeding_review", "playoffs");
    await expectPostBracketPodCorrectionProhibited(
      tournamentId,
      podCalculations[0].match.podId,
      podCalculations[0].match.id
    );
    activate([final.matchInstance.matchId]);

    bracket = resolveBracketAdvancements({
      topology,
      activeMatches: [{
        bracketMatchId: final.id,
        matchId: final.matchInstance.matchId,
        instanceNumber: final.matchInstance.instanceNumber,
        participantTeamIds: final.matchInstance.participantTeamIds,
        participantsFrozen: true,
        status: "final",
        scoreAvailability: "complete",
        winnerTeamId: final.matchInstance.participantTeamIds[0]
      }]
    });
    expect(bracket.championTeamId).toBe(final.matchInstance.participantTeamIds[0]);
    trace.advance("playoffs", "completed");
    activate([final.matchInstance.matchId]);

    expect(trace.phases).toEqual([
      "draft_setup",
      "setup_published",
      "pod_play",
      "seeding_review",
      "playoffs",
      "completed"
    ]);
    expect(broadcasts.filter(isTournamentUpdate).map(eventVersion)).toEqual([
      1, 2, 3, 4, 5
    ]);
    expect(broadcasts.every(hasStablePublicTournamentIdentity)).toBe(true);
  });
});

class LifecycleTrace {
  readonly phases: TournamentLifecycle[] = ["draft_setup"];

  constructor(readonly tournamentId: string) {}

  get current(): TournamentLifecycle {
    return this.phases[this.phases.length - 1];
  }

  get length(): number {
    return this.phases.length;
  }

  advance(expected: TournamentLifecycle, next: TournamentLifecycle): void {
    if (this.current !== expected) {
      throw new Error(`Lifecycle discontinuity before ${next}.`);
    }
    this.phases.push(next);
  }
}

function statisticsFor(
  match: ScheduledPodMatch,
  winnerCups: number,
  loserCups: number,
  revisionSequence: number
): { revision: CanonicalStatisticRevision; calculation: CanonicalStatisticCalculation } {
  const teams = match.participantTeamIds.map((teamId, sideIndex) => {
    const setupTeam = completeSmallTournamentFixture.setup.teams.find(
      (team) => team.id === teamId
    );
    if (setupTeam === undefined) throw new Error("Scheduled team lost its roster.");
    return {
      sideNumber: sideIndex + 1 as 1 | 2,
      teamId,
      players: setupTeam.playerIds.map((playerId, rosterIndex) => ({
        playerId,
        rosterMembershipId: null,
        rosterSlot: rosterIndex + 1
      }))
    };
  }) as unknown as CanonicalStatisticRevision["teams"];
  let sequence = 0;
  const events = teams.flatMap((team, teamIndex) =>
    Array.from({ length: teamIndex === 0 ? winnerCups : loserCups }, () => ({
      eventId: uuid(10_000 + revisionSequence * 100 + sequence),
      sequence: sequence += 1,
      type: "shot_attempt" as const,
      teamId: team.teamId,
      playerId: team.players[sequence % team.players.length].playerId,
      shotAttempt: { outcome: "make" as const, cupDelta: 1 }
    }))
  );
  const revision: CanonicalStatisticRevision = {
    tournamentId: match.tournamentId,
    matchId: match.id,
    revisionId: uuid(6_000 + revisionSequence),
    stage: "pod_play",
    podId: match.podId,
    teams,
    events
  };
  return {
    revision,
    calculation: calculateCanonicalMatchStatistics(revision, 1)
  };
}

function metric(
  calculation: CanonicalStatisticCalculation,
  teamId: string,
  name: CanonicalStatisticMetric
): number {
  const value = calculation.values.find((candidate) =>
    candidate.subjectType === "team" &&
    candidate.subjectId === teamId &&
    candidate.metric === name
  )?.value;
  return value ?? 0;
}

async function expectPostBracketPodCorrectionProhibited(
  tournamentId: TournamentId,
  podId: PodId,
  matchId: MatchId
): Promise<void> {
  const query = jest.fn(async (text: string) => {
    if (text.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (text.includes("FROM engine_tournaments tournament")) {
      return { rows: [{
        lifecycle: "playoffs",
        row_version: 4,
        qualifiers_per_pod: 1,
        games_per_pair: 1,
        bracket_size: 2
      }] };
    }
    throw new Error("Qualification query crossed the correction guard.");
  });
  const client = { query } as unknown as PoolClient;
  const transaction = createPostgresTransactionContext({
    id: "qualification-transaction",
    startedAt: "2036-01-01T00:00:00.000Z"
  }, client);
  const repository = new PostgresTournamentProgressionRepository(
    {} as PostgresDatabase
  );

  await expect(repository.invalidatePodFinalizationInTransaction({
    invalidationId: uuid(9_000),
    tournamentId,
    podId,
    expectedTournamentRowVersion: 4,
    replacementCalculationId: uuid(9_001),
    correctionMatchId: matchId,
    correctionRevisionId: parseStableUuid(
      uuid(9_002),
      "match_revision"
    ) as MatchRevisionId,
    confirmationDigest: "b".repeat(64),
    administratorId: uuid(9_003),
    occurredAt: "2036-01-01T00:01:00.000Z",
    reason: "Sanitized prohibited post-bracket correction"
  }, transaction)).rejects.toThrow(
    "Finalized pods may be invalidated only during seeding review."
  );
  expect(query).toHaveBeenCalledTimes(2);
}

function requireNumber(value: number | null): number {
  if (value === null) throw new Error("Expected a finalized standing rank.");
  return value;
}

function isTournamentUpdate(event: unknown): boolean {
  return isRecord(event) && event.type === "tournament.updated";
}

function eventVersion(event: unknown): unknown {
  return isRecord(event) ? event.projectionVersion : undefined;
}

function hasStablePublicTournamentIdentity(event: unknown): boolean {
  return isRecord(event) && event.tournamentId === "qualification-lifecycle";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}
