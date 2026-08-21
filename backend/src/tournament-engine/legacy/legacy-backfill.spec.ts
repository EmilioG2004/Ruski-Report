import {
  LegacyBackfillRepository,
  LegacySnapshotReader
} from "./legacy-backfill.repository";
import {
  LegacyBackfillPlan,
  LegacyBackfillRecordedState,
  LegacyBackfillRunRecord,
  LegacyTournamentSource
} from "./legacy-backfill.types";
import { LegacyBackfillPlanner } from "./legacy-backfill-planner";
import {
  LegacyBackfillClock,
  LegacyBackfillService
} from "./legacy-backfill.service";
import { syntheticPopulatedLegacySource } from "./synthetic-legacy.fixture";

describe("2026 legacy canonical backfill", () => {
  it("plans deterministic UUID mappings while preserving existing public keys", () => {
    const planner = new LegacyBackfillPlanner();
    const first = planner.plan(syntheticPopulatedLegacySource());
    const reordered = syntheticPopulatedLegacySource();
    reordered.players.reverse();
    reordered.matchIdentities.reverse();
    reordered.matchIdentities[0]?.commentIds.reverse();
    const second = planner.plan(reordered);

    expect(second).toEqual(first);
    expect(first.tournament.id).toMatch(uuidV5Pattern);
    expect(first.tournament.publicKey).toBe(
      "legacy-tournament-2026-synthetic"
    );
    expect(first.tournament).toMatchObject({
      lifecycle: "completed",
      visibility: "public",
      configuration: {
        formatType: "pod_and_single_elimination",
        teamCount: 4,
        podCount: 2,
        podSizes: [2, 2],
        playersPerTeam: 2,
        qualifiersPerPod: 2,
        bracketSize: 4
      }
    });
    expect(first.teams.map((team) => team.publicKey)).toEqual([
      "legacy-team-alpha",
      "legacy-team-bravo",
      "legacy-team-charlie",
      "legacy-team-delta"
    ]);
    expect(first.players[0]?.publicKey).toBe("legacy-player-a-former");
    expect(first.pods[0]?.publicKey).toBe("legacy-pod-a");
    expect(
      first.matches.find(
        (match) => match.legacyMatchId === "legacy-match-historical-identity"
      )
    ).toMatchObject({
      publicKey: "legacy-match-historical-identity",
      identityOnly: true,
      stage: "legacy_unknown",
      scoreAvailability: "unrecorded"
    });
    expect(first.rosterMemberships[0]?.publicKey).toMatch(
      /^legacy_roster_membership_[0-9a-f]{32}$/
    );
    expect(first.sourceDigest).toMatch(sha256Pattern);
    expect(first.planDigest).toMatch(sha256Pattern);
    expect(first.mappingDigest).toMatch(sha256Pattern);
  });

  it("covers populated legacy structures and historical identity references", () => {
    const plan = new LegacyBackfillPlanner().plan(
      syntheticPopulatedLegacySource()
    );

    expect(plan.counts).toEqual({
      tournaments: 1,
      teams: 4,
      players: 9,
      rosterMemberships: 8,
      pods: 2,
      matches: 5,
      identityOnlyMatches: 1,
      matchRevisions: 4,
      matchParticipants: 8,
      standingCalculations: 2,
      standingCalculationMatches: 1,
      standings: 4,
      podFinalizations: 2,
      podFinalizationProvenance: 2,
      seedCalculations: 1,
      seeds: 4,
      brackets: 1,
      bracketRounds: 2,
      bracketMatches: 3,
      bracketSlots: 6,
      scoringEvents: 5,
      shotAttempts: 4,
      shotClassifications: 2,
      statisticRuns: 5,
      statisticValues: 658,
      activeStatisticRuns: 1,
      activePodStandingCalculations: 2,
      activeTournamentStandingCalculations: 0,
      seedCalculationFinalizations: 2,
      activeSeedCalculations: 1,
      bracketPublications: 1,
      activeBrackets: 1,
      bracketResolutions: 3,
      activeBracketResolutions: 3,
      bracketAdvancements: 2,
      projectionVersions: 1,
      tournamentProjectionPayloads: 1,
      matchProjectionPayloads: 4,
      projectionActivations: 1
    });
    expect(
      plan.matches.find(
        (match) => match.legacyMatchId === "legacy-match-bracket-only-final"
      )
    ).toMatchObject({
      publicKey: "legacy-match-bracket-only-final",
      stage: "playoffs",
      scoreAvailability: "unrecorded",
      identityOnly: false
    });
    const playoffRevision = plan.matchRevisions.find((revision) =>
      revision.participants.some((participant) =>
        participant.playerIds.includes(
          plan.players.find(
            (player) => player.legacyPlayerId === "legacy-player-a-former"
          )?.id ?? "missing"
        )
      )
    );
    expect(playoffRevision).toBeDefined();
    expect(plan.bracket?.rounds[1]?.matches[0]).toMatchObject({
      publicKey: "legacy-bracket-final",
      matchId: plan.matches.find(
        (match) => match.legacyMatchId === "legacy-match-bracket-only-final"
      )?.id
    });
    const structuralBracketMatch = plan.bracket?.rounds[0]?.matches[1];
    expect(structuralBracketMatch).toMatchObject({
      publicKey: "legacy-bracket-semi-2"
    });
    expect(
      plan.matches.find((match) => match.id === structuralBracketMatch?.matchId)
    ).toMatchObject({
      legacyBracketMatchId: "legacy-bracket-semi-2",
      publicKey: expect.stringMatching(/^legacy_match_[0-9a-f]{32}$/),
      status: "final",
      scoreAvailability: "unrecorded",
      sourceSnapshotBacked: false
    });
    expect(
      plan.identityReferences.find(
        (reference) =>
          reference.legacyMatchId === "legacy-match-historical-identity"
      )
    ).toMatchObject({
      commentIds: ["synthetic-comment-historical"],
      reportIds: ["synthetic-report-historical"]
    });
  });

  it("derives legacy playoff seeds from stable bracket slots", () => {
    const source = syntheticPopulatedLegacySource();
    source.teams.forEach((team) => {
      delete team.overallSeed;
    });

    const plan = new LegacyBackfillPlanner().plan(source);

    expect(plan.seedCalculation).toBeDefined();
    expect(plan.seeds.map((seed) => seed.effectivePlayoffSeed).sort(
      (left, right) => (left ?? 0) - (right ?? 0)
    )).toEqual([1, 2, 3, 4]);
  });

  it("keeps the completion key stable when community references grow", () => {
    const source = syntheticPopulatedLegacySource();
    const initial = new LegacyBackfillPlanner().plan(source);
    source.matchIdentities[0]?.commentIds.push("later-comment");
    source.matchIdentities[0]?.reportIds.push("later-report");
    const later = new LegacyBackfillPlanner().plan(source);

    expect(later.sourceDigest).toBe(initial.sourceDigest);
    expect(later.planDigest).toBe(initial.planDigest);
    expect(later.counts).toEqual(initial.counts);
  });

  it("normalizes legacy Ruski events without double-counting special misses", () => {
    const plan = new LegacyBackfillPlanner().plan(
      syntheticPopulatedLegacySource()
    );
    const events = plan.matchRevisions.flatMap((revision) => revision.events);

    expect(events).toHaveLength(5);
    expect(events.filter((event) => event.type === "shot_attempt")).toHaveLength(4);
    expect(events.filter((event) => event.type === "vom")).toHaveLength(1);
    expect(events.find((event) =>
      event.shotAttempt?.classification === "tri"
    )?.shotAttempt).toEqual({
      outcome: "miss",
      classification: "tri",
      cupDelta: 3,
      phase: "normal",
      turnNumber: 2,
      teamTurnOrder: 2,
      shotInTeamTurn: 1
    });
  });

  it("records a dry run without applying canonical rows", async () => {
    const source = syntheticPopulatedLegacySource();
    const repository = new InMemoryLegacyBackfillRepository();
    const service = createService(source, repository);

    const result = await service.run({
      legacyTournamentId: source.legacyTournamentId,
      dryRun: true
    });

    expect(result).toMatchObject({
      status: "dry_run",
      dryRun: true,
      retryable: false,
      issues: []
    });
    expect(repository.applyCalls).toBe(0);
    expect(repository.state).toBeNull();
    expect(repository.runs).toHaveLength(1);
    expect(repository.runs[0]?.sourceDigest).toBe(result.sourceDigest);
  });

  it.each([
    {
      label: "duplicate bracket round IDs",
      code: "LEGACY_BRACKET_ROUND_DUPLICATE",
      mutate: (source: LegacyTournamentSource) => {
        const rounds = requireBracket(source).rounds;
        rounds[1]!.legacyRoundId = rounds[0]!.legacyRoundId;
      }
    },
    {
      label: "duplicate bracket round sequences",
      code: "LEGACY_BRACKET_ROUND_SEQUENCE_DUPLICATE",
      mutate: (source: LegacyTournamentSource) => {
        const rounds = requireBracket(source).rounds;
        rounds[1]!.sequence = rounds[0]!.sequence;
      }
    },
    {
      label: "duplicate bracket match IDs",
      code: "LEGACY_BRACKET_MATCH_DUPLICATE",
      mutate: (source: LegacyTournamentSource) => {
        const matches = requireBracket(source).rounds[0]!.matches;
        matches[1]!.legacyBracketMatchId = matches[0]!.legacyBracketMatchId;
      }
    },
    {
      label: "duplicate bracket match sequences",
      code: "LEGACY_BRACKET_MATCH_SEQUENCE_DUPLICATE",
      mutate: (source: LegacyTournamentSource) => {
        const matches = requireBracket(source).rounds[0]!.matches;
        matches[1]!.sequence = matches[0]!.sequence;
      }
    },
    {
      label: "a bracket match without exactly two slots",
      code: "LEGACY_BRACKET_SLOT_COUNT_INVALID",
      mutate: (source: LegacyTournamentSource) => {
        requireBracket(source).rounds[0]!.matches[0]!.slots.pop();
      }
    }
  ])("rejects $label during dry-run planning", async ({ code, mutate }) => {
    const source = syntheticPopulatedLegacySource();
    mutate(source);
    const repository = new InMemoryLegacyBackfillRepository();
    const result = await createService(source, repository).run({
      legacyTournamentId: source.legacyTournamentId,
      dryRun: true
    });

    expect(result.status).toBe("failed");
    expect(result.retryable).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })])
    );
    expect(repository.applyCalls).toBe(0);
  });

  it("applies once and reports a deterministic second run as a no-op", async () => {
    const source = syntheticPopulatedLegacySource();
    const repository = new InMemoryLegacyBackfillRepository();
    const service = createService(source, repository);

    const first = await service.run({
      legacyTournamentId: source.legacyTournamentId
    });
    const second = await service.run({
      legacyTournamentId: source.legacyTournamentId
    });

    expect(first.status).toBe("applied");
    expect(second).toMatchObject({
      status: "no_op",
      retryable: false,
      sourceDigest: first.sourceDigest,
      planDigest: first.planDigest,
      mappingDigest: first.mappingDigest,
      counts: first.counts
    });
    expect(repository.applyCalls).toBe(1);
    expect(repository.runs.map((run) => run.status)).toEqual([
      "applied",
      "no_op"
    ]);
  });

  it("reports digest and count mismatches without attempting a write", async () => {
    const source = syntheticPopulatedLegacySource();
    const plan = new LegacyBackfillPlanner().plan(source);
    const repository = new InMemoryLegacyBackfillRepository();
    repository.state = {
      ...stateFromPlan(plan),
      sourceDigest: "0".repeat(64),
      counts: {
        ...plan.counts,
        matches: plan.counts.matches - 1
      }
    };
    const service = createService(source, repository);

    const result = await service.run({
      legacyTournamentId: source.legacyTournamentId
    });

    expect(result.status).toBe("mismatch");
    expect(result.retryable).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "LEGACY_SOURCE_DIGEST_MISMATCH" }),
        expect.objectContaining({ code: "LEGACY_COUNT_MATCHES_MISMATCH" })
      ])
    );
    expect(repository.applyCalls).toBe(0);
    expect(repository.runs.at(-1)?.status).toBe("mismatch");
  });

  it("records an atomic apply failure and succeeds on retry", async () => {
    const source = syntheticPopulatedLegacySource();
    const repository = new InMemoryLegacyBackfillRepository();
    repository.failNextApply = true;
    const service = createService(source, repository);

    const failed = await service.run({
      legacyTournamentId: source.legacyTournamentId
    });
    const retried = await service.run({
      legacyTournamentId: source.legacyTournamentId
    });

    expect(failed).toMatchObject({
      status: "failed",
      retryable: true,
      issues: [
        expect.objectContaining({ code: "LEGACY_BACKFILL_APPLY_FAILED" })
      ]
    });
    expect(repository.state).not.toBeNull();
    expect(retried.status).toBe("applied");
    expect(repository.applyCalls).toBe(2);
    expect(repository.runs.map((run) => run.status)).toEqual([
      "failed",
      "applied"
    ]);
  });

  it("reports source validation failures without exposing fixture content", async () => {
    const source = syntheticPopulatedLegacySource();
    source.year = 2025;
    const repository = new InMemoryLegacyBackfillRepository();
    const service = createService(source, repository);

    const result = await service.run({
      legacyTournamentId: source.legacyTournamentId
    });

    expect(result).toMatchObject({
      status: "failed",
      retryable: false,
      issues: [
        expect.objectContaining({ code: "LEGACY_YEAR_MISMATCH" })
      ]
    });
    expect(JSON.stringify(result)).not.toContain("Alpha Former");
    expect(repository.applyCalls).toBe(0);
  });
});

class StaticLegacySnapshotReader implements LegacySnapshotReader {
  constructor(private readonly source: LegacyTournamentSource) {}

  async readActiveSnapshot(
    legacyTournamentId: string
  ): Promise<LegacyTournamentSource | null> {
    return legacyTournamentId === this.source.legacyTournamentId
      ? structuredClone(this.source)
      : null;
  }
}

class InMemoryLegacyBackfillRepository implements LegacyBackfillRepository {
  state: LegacyBackfillRecordedState | null = null;
  runs: LegacyBackfillRunRecord[] = [];
  applyCalls = 0;
  failNextApply = false;

  async findRecordedState(): Promise<LegacyBackfillRecordedState | null> {
    return this.state === null ? null : structuredClone(this.state);
  }

  async apply(
    plan: LegacyBackfillPlan,
    run: LegacyBackfillRunRecord
  ): Promise<LegacyBackfillRecordedState> {
    this.applyCalls += 1;
    if (this.failNextApply) {
      this.failNextApply = false;
      throw new Error("Synthetic transactional failure.");
    }

    const state = stateFromPlan(plan);
    this.state = state;
    this.runs.push(structuredClone(run));
    return structuredClone(state);
  }

  async recordRun(run: LegacyBackfillRunRecord): Promise<void> {
    this.runs.push(structuredClone(run));
  }
}

class AdvancingClock implements LegacyBackfillClock {
  private second = 0;

  now(): string {
    const value = new Date(Date.UTC(2026, 7, 20, 12, 0, this.second));
    this.second += 1;
    return value.toISOString();
  }
}

function createService(
  source: LegacyTournamentSource,
  repository: LegacyBackfillRepository
): LegacyBackfillService {
  let run = 0;
  return new LegacyBackfillService(
    new StaticLegacySnapshotReader(source),
    repository,
    new LegacyBackfillPlanner(),
    new AdvancingClock(),
    () => `synthetic-run-${++run}`
  );
}

function stateFromPlan(plan: LegacyBackfillPlan): LegacyBackfillRecordedState {
  return {
    legacyTournamentId: plan.legacyTournamentId,
    sourceSnapshotVersion: plan.sourceSnapshotVersion,
    sourceDigest: plan.sourceDigest,
    planDigest: plan.planDigest,
    mappingDigest: plan.mappingDigest,
    counts: structuredClone(plan.counts)
  };
}

const uuidV5Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

function requireBracket(source: LegacyTournamentSource) {
  if (source.bracket === undefined) {
    throw new Error("Synthetic populated fixture must include a bracket.");
  }
  return source.bracket;
}
