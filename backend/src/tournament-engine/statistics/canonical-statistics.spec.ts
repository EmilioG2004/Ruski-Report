import {
  calculateCanonicalAggregateStatistics,
  calculateCanonicalMatchStatistics
} from "./canonical-statistics";
import {
  CanonicalStatisticEvent,
  CanonicalStatisticRevision,
  CanonicalStatisticValue
} from "./types";

describe("canonical Ruski statistics", () => {
  it("counts every special miss once while keeping Vom outside attempts", () => {
    const revision = fixtureRevision({
      events: [
        shot(1, "player-a", "team-a", "make", undefined, 1),
        shot(2, "player-a", "team-a", "miss", undefined, 0),
        shot(3, "player-a", "team-a", "miss", "splash_out", 0),
        shot(4, "player-a", "team-a", "miss", "guy", 0),
        shot(5, "player-a", "team-a", "miss", "di", 2),
        shot(6, "player-a", "team-a", "miss", "tri", 3),
        occurrence(7, "vom", "player-a", "team-a"),
        occurrence(8, "vom", "player-a", "team-a")
      ]
    });

    const calculation = calculateCanonicalMatchStatistics(revision, 1);
    expect(metric(calculation.values, "player", "player-a", "makes")).toBe(1);
    expect(metric(calculation.values, "player", "player-a", "misses")).toBe(5);
    expect(metric(calculation.values, "player", "player-a", "attempts")).toBe(6);
    expect(metric(calculation.values, "player", "player-a", "splash_outs")).toBe(1);
    expect(metric(calculation.values, "player", "player-a", "guys")).toBe(1);
    expect(metric(calculation.values, "player", "player-a", "dis")).toBe(1);
    expect(metric(calculation.values, "player", "player-a", "tris")).toBe(1);
    expect(metric(calculation.values, "player", "player-a", "voms")).toBe(2);
    expect(metric(calculation.values, "player", "player-a", "cups_scored")).toBe(6);
    expect(metric(calculation.values, "team", "team-a", "cups_against")).toBe(0);
    expect(metric(calculation.values, "team", "team-a", "cup_differential")).toBe(6);
    expect(metric(calculation.values, "team", "team-b", "cups_against")).toBe(6);
    expect(metric(calculation.values, "team", "team-b", "cup_differential")).toBe(-6);
    expect(percentage(calculation.values, "player-a")).toMatchObject({
      numerator: 1,
      denominator: 6,
      value: 1 / 6
    });
  });

  it("emits zero rows and a null percentage for every frozen participant", () => {
    const calculation = calculateCanonicalMatchStatistics(fixtureRevision(), 1);
    for (const subjectId of ["player-a", "player-b", "team-a", "team-b"]) {
      expect(metric(
        calculation.values,
        subjectId.startsWith("player") ? "player" : "team",
        subjectId,
        "attempts"
      )).toBe(0);
      const shooting = calculation.values.find((value) =>
        value.subjectId === subjectId && value.metric === "shooting_percentage"
      );
      expect(shooting).toMatchObject({ numerator: 0, denominator: 0, value: null });
    }
  });

  it("seeds registered teams and current roster players before play", () => {
    const calculation = calculateCanonicalAggregateStatistics([], 1, {
      tournamentId: "tournament-a",
      teams: [{ teamId: "team-a", podId: "pod-a", playerIds: ["player-a"] }]
    });
    expect(scopedMetric(
      calculation.values,
      "tournament",
      "all",
      "team-a",
      "attempts"
    )).toBe(0);
    expect(scopedMetric(
      calculation.values,
      "tournament",
      "pod",
      "player-a",
      "attempts"
    )).toBe(0);
    expect(scopedMetric(
      calculation.values,
      "pod",
      "pod",
      "team-a",
      "attempts",
      "pod-a"
    )).toBe(0);
  });

  it("aggregates a shared player across matches, pods, stages, and all", () => {
    const podOne = fixtureRevision({
      matchId: "match-a",
      revisionId: "revision-a",
      podId: "pod-a",
      events: [shot(1, "player-a", "team-a", "make", undefined, 1)]
    });
    const podTwo = fixtureRevision({
      matchId: "match-b",
      revisionId: "revision-b",
      podId: "pod-a",
      events: [shot(1, "player-a", "team-a", "miss", "di", 2)]
    });
    const playoff = fixtureRevision({
      matchId: "match-c",
      revisionId: "revision-c",
      stage: "playoffs",
      podId: undefined,
      events: [shot(1, "player-a", "team-a", "make", undefined, 1)]
    });

    const calculation = calculateCanonicalAggregateStatistics(
      [playoff, podTwo, podOne],
      1
    );
    expect(scopedMetric(
      calculation.values,
      "tournament",
      "all",
      "player-a",
      "attempts"
    )).toBe(3);
    expect(scopedMetric(
      calculation.values,
      "tournament",
      "pod",
      "player-a",
      "attempts"
    )).toBe(2);
    expect(scopedMetric(
      calculation.values,
      "tournament",
      "playoff",
      "player-a",
      "attempts"
    )).toBe(1);
    expect(scopedMetric(
      calculation.values,
      "pod",
      "pod",
      "player-a",
      "cups_scored",
      "pod-a"
    )).toBe(3);
  });

  it("uses only the supplied active correction and keeps its digest deterministic", () => {
    const original = fixtureRevision({
      revisionId: "revision-1",
      events: [shot(1, "player-a", "team-a", "make", undefined, 1)]
    });
    const correction = fixtureRevision({
      revisionId: "revision-2",
      events: [shot(1, "player-a", "team-a", "miss", "tri", 3)]
    });
    const corrected = calculateCanonicalAggregateStatistics([correction], 1);
    expect(scopedMetric(
      corrected.values,
      "tournament",
      "all",
      "player-a",
      "makes"
    )).toBe(0);
    expect(scopedMetric(
      corrected.values,
      "tournament",
      "all",
      "player-a",
      "misses"
    )).toBe(1);
    expect(calculateCanonicalAggregateStatistics([
      { ...correction, events: [...correction.events].reverse() }
    ], 1).inputDigest).toBe(corrected.inputDigest);
    expect(calculateCanonicalAggregateStatistics([original], 1).inputDigest)
      .not.toBe(corrected.inputDigest);
  });

  it("rejects invalid cup effects, duplicate active matches, and mixed tournaments", () => {
    expect(() => calculateCanonicalMatchStatistics(fixtureRevision({
      events: [shot(1, "player-a", "team-a", "miss", "tri", 0)]
    }), 1)).toThrow(/cup effect/i);
    const revision = fixtureRevision();
    expect(() => calculateCanonicalAggregateStatistics([
      revision,
      { ...revision, revisionId: "other-revision" }
    ], 1)).toThrow(/one active revision/i);
    expect(() => calculateCanonicalAggregateStatistics([
      revision,
      fixtureRevision({
        tournamentId: "tournament-b",
        matchId: "match-b",
        revisionId: "revision-b"
      })
    ], 1)).toThrow(/mix tournaments/i);
  });
});

function fixtureRevision(overrides: Partial<CanonicalStatisticRevision> = {}): CanonicalStatisticRevision {
  return {
    tournamentId: "tournament-a",
    matchId: "match-a",
    revisionId: "revision-a",
    stage: "pod_play",
    podId: "pod-a",
    teams: [
      {
        sideNumber: 1,
        teamId: "team-a",
        players: [{
          playerId: "player-a",
          rosterMembershipId: "membership-a",
          rosterSlot: 1
        }]
      },
      {
        sideNumber: 2,
        teamId: "team-b",
        players: [{
          playerId: "player-b",
          rosterMembershipId: "membership-b",
          rosterSlot: 1
        }]
      }
    ],
    events: [],
    ...overrides
  };
}

function shot(
  sequence: number,
  playerId: string,
  teamId: string,
  outcome: "make" | "miss",
  classification: "guy" | "di" | "tri" | "splash_out" | undefined,
  cupDelta: number
): CanonicalStatisticEvent {
  return {
    eventId: `event-${sequence}`,
    sequence,
    type: "shot_attempt",
    teamId,
    playerId,
    shotAttempt: { outcome, classification, cupDelta }
  };
}

function occurrence(
  sequence: number,
  type: "vom",
  playerId: string,
  teamId: string
): CanonicalStatisticEvent {
  return { eventId: `event-${sequence}`, sequence, type, teamId, playerId };
}

function metric(
  values: readonly CanonicalStatisticValue[],
  subjectType: "player" | "team",
  subjectId: string,
  metricName: CanonicalStatisticValue["metric"]
): number | null | undefined {
  return values.find((value) =>
    value.subjectType === subjectType && value.subjectId === subjectId &&
    value.metric === metricName
  )?.value;
}

function scopedMetric(
  values: readonly CanonicalStatisticValue[],
  scope: "pod" | "tournament",
  stage: "pod" | "playoff" | "all",
  subjectId: string,
  metricName: CanonicalStatisticValue["metric"],
  podId?: string
): number | null | undefined {
  return values.find((value) =>
    value.scope === scope && value.stage === stage &&
    value.subjectId === subjectId && value.metric === metricName &&
    value.podId === podId
  )?.value;
}

function percentage(
  values: readonly CanonicalStatisticValue[],
  subjectId: string
): CanonicalStatisticValue | undefined {
  return values.find((value) =>
    value.subjectId === subjectId && value.metric === "shooting_percentage"
  );
}
