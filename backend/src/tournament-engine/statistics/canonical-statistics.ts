import { createHash } from "node:crypto";

import {
  CanonicalStatisticCalculation,
  CanonicalStatisticEvent,
  CanonicalStatisticMetric,
  CanonicalStatisticRevision,
  CanonicalStatisticStage,
  CanonicalStatisticSubjectType,
  CanonicalStatisticUniverse,
  CanonicalStatisticValue
} from "./types";

const COUNT_METRICS = [
  "makes",
  "misses",
  "attempts",
  "splash_outs",
  "guys",
  "tris",
  "dis",
  "voms",
  "cups_scored"
] as const satisfies readonly CanonicalStatisticMetric[];

interface Accumulator {
  makes: number;
  misses: number;
  attempts: number;
  splash_outs: number;
  guys: number;
  tris: number;
  dis: number;
  voms: number;
  cups_scored: number;
  cups_against: number;
  cup_differential: number;
}

interface SubjectAccumulator {
  subjectType: CanonicalStatisticSubjectType;
  subjectId: string;
  stats: Accumulator;
}

interface AggregateBucket {
  scope: "pod" | "tournament";
  podId?: string;
  stage: CanonicalStatisticStage;
  subjects: Map<string, SubjectAccumulator>;
}

export function calculateCanonicalMatchStatistics(
  revision: CanonicalStatisticRevision,
  rulesVersion: number
): CanonicalStatisticCalculation {
  validateRulesVersion(rulesVersion);
  validateRevision(revision);
  const stage = statisticStage(revision);
  const subjects = initializeRevisionSubjects(revision);
  applyRevision(revision, subjects);
  return {
    inputDigest: statisticDigest("canonical-match-statistics-v1", rulesVersion, [revision]),
    rulesVersion,
    values: valuesForSubjects(subjects, {
      scope: "match",
      matchId: revision.matchId,
      stage
    })
  };
}

export function calculateCanonicalAggregateStatistics(
  revisions: readonly CanonicalStatisticRevision[],
  rulesVersion: number,
  universe?: CanonicalStatisticUniverse
): CanonicalStatisticCalculation {
  validateRulesVersion(rulesVersion);
  const ordered = [...revisions].sort(compareRevision);
  validateAggregateRevisions(ordered, universe);
  const buckets = new Map<string, AggregateBucket>();
  seedUniverseBuckets(buckets, universe);

  for (const revision of ordered) {
    const stage = statisticStage(revision);
    const revisionSubjects = initializeRevisionSubjects(revision);
    applyRevision(revision, revisionSubjects);
    mergeBucket(buckets, "tournament", undefined, stage, revisionSubjects);
    mergeBucket(buckets, "tournament", undefined, "all", revisionSubjects);
    if (revision.podId !== undefined) {
      mergeBucket(buckets, "pod", revision.podId, "pod", revisionSubjects);
    }
  }

  const values = [...buckets.values()]
    .sort(compareBucket)
    .flatMap((bucket) => valuesForSubjects(bucket.subjects, {
      scope: bucket.scope,
      podId: bucket.podId,
      stage: bucket.stage
    }));
  return {
    inputDigest: statisticDigest(
      "canonical-tournament-statistics-v1",
      rulesVersion,
      ordered,
      universe
    ),
    rulesVersion,
    values
  };
}

function seedUniverseBuckets(
  buckets: Map<string, AggregateBucket>,
  universe: CanonicalStatisticUniverse | undefined
): void {
  if (universe === undefined) {
    return;
  }
  for (const team of universe.teams) {
    const subjects = new Map<string, SubjectAccumulator>();
    subjects.set(subjectKey("team", team.teamId), {
      subjectType: "team",
      subjectId: team.teamId,
      stats: emptyAccumulator()
    });
    for (const playerId of team.playerIds) {
      subjects.set(subjectKey("player", playerId), {
        subjectType: "player",
        subjectId: playerId,
        stats: emptyAccumulator()
      });
    }
    mergeBucket(buckets, "tournament", undefined, "all", subjects);
    mergeBucket(buckets, "tournament", undefined, "pod", subjects);
    mergeBucket(buckets, "pod", team.podId, "pod", subjects);
  }
}

function initializeRevisionSubjects(
  revision: CanonicalStatisticRevision
): Map<string, SubjectAccumulator> {
  const subjects = new Map<string, SubjectAccumulator>();
  for (const team of revision.teams) {
    subjects.set(subjectKey("team", team.teamId), {
      subjectType: "team",
      subjectId: team.teamId,
      stats: emptyAccumulator()
    });
    for (const player of team.players) {
      subjects.set(subjectKey("player", player.playerId), {
        subjectType: "player",
        subjectId: player.playerId,
        stats: emptyAccumulator()
      });
    }
  }
  return subjects;
}

function applyRevision(
  revision: CanonicalStatisticRevision,
  subjects: Map<string, SubjectAccumulator>
): void {
  const teamByPlayer = new Map<string, string>();
  for (const team of revision.teams) {
    for (const player of team.players) {
      teamByPlayer.set(player.playerId, team.teamId);
    }
  }
  for (const event of [...revision.events].sort((left, right) =>
    left.sequence - right.sequence || left.eventId.localeCompare(right.eventId)
  )) {
    applyEvent(event, subjects, teamByPlayer);
  }
  const teamSubjects = [...subjects.values()].filter((subject) =>
    subject.subjectType === "team"
  );
  for (const subject of teamSubjects) {
    subject.stats.cups_against = teamSubjects
      .filter((other) => other.subjectId !== subject.subjectId)
      .reduce((total, other) => total + other.stats.cups_scored, 0);
    subject.stats.cup_differential =
      subject.stats.cups_scored - subject.stats.cups_against;
  }
}

function applyEvent(
  event: CanonicalStatisticEvent,
  subjects: Map<string, SubjectAccumulator>,
  teamByPlayer: ReadonlyMap<string, string>
): void {
  if (event.type === "shot_attempt") {
    const attempt = event.shotAttempt;
    if (attempt === undefined || event.teamId === undefined || event.playerId === undefined) {
      invalid("Canonical shot attempts require team, player, and attempt payloads.");
    }
    if (teamByPlayer.get(event.playerId) !== event.teamId) {
      invalid("Canonical shot attribution must match frozen participants.");
    }
    validateAttempt(attempt);
    for (const subject of requiredEventSubjects(subjects, event)) {
      subject.stats.attempts += 1;
      subject.stats.cups_scored += attempt.cupDelta;
      if (attempt.outcome === "make") {
        subject.stats.makes += 1;
      } else {
        subject.stats.misses += 1;
        if (attempt.classification !== undefined) {
          subject.stats[classificationMetric(attempt.classification)] += 1;
        }
      }
    }
    return;
  }
  if (event.shotAttempt !== undefined) {
    invalid("Only shot_attempt events may contain a shot payload.");
  }
  if (event.type === "vom") {
    for (const subject of requiredEventSubjects(subjects, event)) {
      subject.stats.voms += 1;
    }
  }
}

function requiredEventSubjects(
  subjects: Map<string, SubjectAccumulator>,
  event: CanonicalStatisticEvent
): readonly SubjectAccumulator[] {
  if (event.teamId === undefined || event.playerId === undefined) {
    invalid("Attributed Ruski scoring occurrences require team and player identity.");
  }
  const team = subjects.get(subjectKey("team", event.teamId));
  const player = subjects.get(subjectKey("player", event.playerId));
  if (team === undefined || player === undefined) {
    invalid("Scoring occurrence references a subject outside the revision participants.");
  }
  return [team, player];
}

function validateAttempt(
  attempt: NonNullable<CanonicalStatisticEvent["shotAttempt"]>
): void {
  if (attempt.outcome === "make") {
    if (attempt.classification !== undefined || attempt.cupDelta !== 1) {
      invalid("A Ruski make has one cup and no miss classification.");
    }
    return;
  }
  const expectedCupDelta = attempt.classification === "tri"
    ? 3
    : attempt.classification === "di" ? 2 : 0;
  if (attempt.cupDelta !== expectedCupDelta) {
    invalid("Ruski miss cup effect must match its special classification.");
  }
}

function valuesForSubjects(
  subjects: ReadonlyMap<string, SubjectAccumulator>,
  identity: {
    scope: "match" | "pod" | "tournament";
    matchId?: string;
    podId?: string;
    stage: CanonicalStatisticStage;
  }
): CanonicalStatisticValue[] {
  return [...subjects.values()]
    .sort(compareSubject)
    .flatMap((subject) => {
      const counts = COUNT_METRICS.map((metric): CanonicalStatisticValue => ({
        ...identity,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        metric,
        numerator: subject.stats[metric],
        denominator: null,
        value: subject.stats[metric]
      }));
      const percentage: CanonicalStatisticValue = {
        ...identity,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        metric: "shooting_percentage",
        numerator: subject.stats.makes,
        denominator: subject.stats.attempts,
        value: subject.stats.attempts === 0
          ? null
          : subject.stats.makes / subject.stats.attempts
      };
      if (subject.subjectType === "player") {
        return [...counts, percentage];
      }
      return [
        ...counts,
        percentage,
        countValue(identity, subject, "cups_against"),
        countValue(identity, subject, "cup_differential")
      ];
    });
}

function countValue(
  identity: Parameters<typeof valuesForSubjects>[1],
  subject: SubjectAccumulator,
  metric: "cups_against" | "cup_differential"
): CanonicalStatisticValue {
  return {
    ...identity,
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    metric,
    numerator: subject.stats[metric],
    denominator: null,
    value: subject.stats[metric]
  };
}

function mergeBucket(
  buckets: Map<string, AggregateBucket>,
  scope: AggregateBucket["scope"],
  podId: string | undefined,
  stage: CanonicalStatisticStage,
  revisionSubjects: ReadonlyMap<string, SubjectAccumulator>
): void {
  const key = `${scope}:${podId ?? "none"}:${stage}`;
  let bucket = buckets.get(key);
  if (bucket === undefined) {
    bucket = { scope, podId, stage, subjects: new Map() };
    buckets.set(key, bucket);
  }
  for (const subject of revisionSubjects.values()) {
    const keyForSubject = subjectKey(subject.subjectType, subject.subjectId);
    const target = bucket.subjects.get(keyForSubject) ?? {
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      stats: emptyAccumulator()
    };
    addAccumulator(target.stats, subject.stats);
    bucket.subjects.set(keyForSubject, target);
  }
}

function addAccumulator(target: Accumulator, source: Accumulator): void {
  target.makes += source.makes;
  target.misses += source.misses;
  target.attempts += source.attempts;
  target.splash_outs += source.splash_outs;
  target.guys += source.guys;
  target.tris += source.tris;
  target.dis += source.dis;
  target.voms += source.voms;
  target.cups_scored += source.cups_scored;
  target.cups_against += source.cups_against;
  target.cup_differential += source.cup_differential;
}

function validateAggregateRevisions(
  revisions: readonly CanonicalStatisticRevision[],
  universe: CanonicalStatisticUniverse | undefined
): void {
  const tournamentIds = new Set(revisions.map((revision) => revision.tournamentId));
  const matchIds = new Set<string>();
  if (tournamentIds.size > 1) {
    invalid("One aggregate calculation cannot mix tournaments.");
  }
  if (universe !== undefined && tournamentIds.size === 1 &&
      !tournamentIds.has(universe.tournamentId)) {
    invalid("Aggregate participant universe must belong to the revision tournament.");
  }
  validateUniverse(universe);
  for (const revision of revisions) {
    validateRevision(revision);
    if (matchIds.has(revision.matchId)) {
      invalid("Aggregate inputs require exactly one active revision per match.");
    }
    matchIds.add(revision.matchId);
  }
}

function validateUniverse(universe: CanonicalStatisticUniverse | undefined): void {
  if (universe === undefined) {
    return;
  }
  const teams = new Set<string>();
  const players = new Set<string>();
  for (const team of universe.teams) {
    if (teams.has(team.teamId) || team.podId.length === 0 ||
        new Set(team.playerIds).size !== team.playerIds.length ||
        team.playerIds.some((playerId) => players.has(playerId))) {
      invalid("Aggregate participant universe requires unique team and player identities.");
    }
    teams.add(team.teamId);
    team.playerIds.forEach((playerId) => players.add(playerId));
  }
}

function validateRevision(revision: CanonicalStatisticRevision): void {
  const sides = revision.teams.map((team) => team.sideNumber).sort();
  const teamIds = new Set(revision.teams.map((team) => team.teamId));
  if (revision.teams.length !== 2 || sides[0] !== 1 || sides[1] !== 2 ||
      teamIds.size !== 2) {
    invalid("Canonical statistics require two distinct revision teams.");
  }
  if ((revision.stage === "pod_play") !== (revision.podId !== undefined)) {
    invalid("Canonical statistic revision stage and pod identity are inconsistent.");
  }
  const players = new Set<string>();
  for (const team of revision.teams) {
    const rosterSlots = new Set<number>();
    for (const player of team.players) {
      if (!Number.isSafeInteger(player.rosterSlot) || player.rosterSlot <= 0 ||
          rosterSlots.has(player.rosterSlot) || players.has(player.playerId)) {
        invalid("Revision players require unique positive roster slots and identities.");
      }
      rosterSlots.add(player.rosterSlot);
      players.add(player.playerId);
    }
  }
  const sequences = new Set<number>();
  const eventIds = new Set<string>();
  for (const event of revision.events) {
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= 0 ||
        sequences.has(event.sequence) || eventIds.has(event.eventId)) {
      invalid("Canonical statistic events require unique positive chronology.");
    }
    sequences.add(event.sequence);
    eventIds.add(event.eventId);
  }
}

function statisticStage(revision: CanonicalStatisticRevision): "pod" | "playoff" {
  return revision.stage === "pod_play" ? "pod" : "playoff";
}

function classificationMetric(
  classification: Exclude<
    NonNullable<CanonicalStatisticEvent["shotAttempt"]>["classification"],
    undefined
  >
): "splash_outs" | "guys" | "tris" | "dis" {
  switch (classification) {
  case "splash_out": return "splash_outs";
  case "guy": return "guys";
  case "tri": return "tris";
  case "di": return "dis";
  }
}

function emptyAccumulator(): Accumulator {
  return {
    makes: 0,
    misses: 0,
    attempts: 0,
    splash_outs: 0,
    guys: 0,
    tris: 0,
    dis: 0,
    voms: 0,
    cups_scored: 0,
    cups_against: 0,
    cup_differential: 0
  };
}

function subjectKey(type: CanonicalStatisticSubjectType, id: string): string {
  return `${type}:${id}`;
}

function compareSubject(left: SubjectAccumulator, right: SubjectAccumulator): number {
  return left.subjectType.localeCompare(right.subjectType) ||
    left.subjectId.localeCompare(right.subjectId);
}

function compareRevision(
  left: CanonicalStatisticRevision,
  right: CanonicalStatisticRevision
): number {
  return left.matchId.localeCompare(right.matchId) ||
    left.revisionId.localeCompare(right.revisionId);
}

function compareBucket(left: AggregateBucket, right: AggregateBucket): number {
  return left.scope.localeCompare(right.scope) ||
    (left.podId ?? "").localeCompare(right.podId ?? "") ||
    left.stage.localeCompare(right.stage);
}

function statisticDigest(
  contract: string,
  rulesVersion: number,
  revisions: readonly CanonicalStatisticRevision[],
  universe?: CanonicalStatisticUniverse
): string {
  return createHash("sha256").update(canonicalJson({
    contract,
    rulesVersion,
    revisions: revisions.map(normalizeRevision),
    universe: universe === undefined ? null : {
      tournamentId: universe.tournamentId,
      teams: [...universe.teams]
        .sort((left, right) => left.teamId.localeCompare(right.teamId))
        .map((team) => ({
          teamId: team.teamId,
          podId: team.podId,
          playerIds: [...team.playerIds].sort()
        }))
    }
  })).digest("hex");
}

function normalizeRevision(revision: CanonicalStatisticRevision): unknown {
  return {
    tournamentId: revision.tournamentId,
    matchId: revision.matchId,
    revisionId: revision.revisionId,
    stage: revision.stage,
    podId: revision.podId ?? null,
    teams: [...revision.teams]
      .sort((left, right) => left.sideNumber - right.sideNumber)
      .map((team) => ({
        sideNumber: team.sideNumber,
        teamId: team.teamId,
        players: [...team.players]
          .sort((left, right) =>
            left.rosterSlot - right.rosterSlot || left.playerId.localeCompare(right.playerId)
          )
          .map((player) => ({
            playerId: player.playerId,
            rosterMembershipId: player.rosterMembershipId,
            rosterSlot: player.rosterSlot
          }))
      })),
    events: [...revision.events]
      .sort((left, right) =>
        left.sequence - right.sequence || left.eventId.localeCompare(right.eventId)
      )
      .map((event) => ({
        eventId: event.eventId,
        sequence: event.sequence,
        type: event.type,
        teamId: event.teamId ?? null,
        playerId: event.playerId ?? null,
        shotAttempt: event.shotAttempt === undefined ? null : {
          outcome: event.shotAttempt.outcome,
          classification: event.shotAttempt.classification ?? null,
          cupDelta: event.shotAttempt.cupDelta
        }
      }))
  };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      invalid("Canonical statistic digests require finite numbers.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  invalid("Canonical statistic digests require JSON values.");
}

function validateRulesVersion(rulesVersion: number): void {
  if (!Number.isSafeInteger(rulesVersion) || rulesVersion <= 0) {
    invalid("Canonical statistic rules version must be a positive integer.");
  }
}

function invalid(message: string): never {
  throw new Error(message);
}
