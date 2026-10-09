import {
  MatchStatus,
  parseStableUuid,
  ScoreAvailability,
  TournamentTeamId
} from "../../domain";
import {
  CalculatePodStandingsInput,
  POD_STANDINGS_RULES_VERSION,
  PodStandingMatchInput,
  PodStandingTeamResult,
  PodStandingTieResolution
} from "../contracts";

export const SANITIZED_STANDINGS_NOW = "2034-04-05T12:00:00.000Z";

export function sanitizedPodStandingsInput(
  teamCount: number,
  qualifiersPerPod: number,
  matches: readonly PodStandingMatchInput[],
  tieResolutions?: readonly PodStandingTieResolution[],
  gamesPerPair = 1
): CalculatePodStandingsInput {
  return {
    tournamentId: parseStableUuid(uuid(1), "tournament"),
    podId: parseStableUuid(uuid(2), "pod"),
    rulesVersion: POD_STANDINGS_RULES_VERSION,
    gamesPerPair,
    qualifiersPerPod,
    teams: Array.from({ length: teamCount }, (_, index) => ({
      teamId: sanitizedTeamId(index + 1),
      initialSeed: index + 1
    })),
    matches,
    ...(tieResolutions === undefined ? {} : { tieResolutions })
  };
}

export function completeSanitizedRoundRobin(
  teamCount: number,
  gamesPerPair: number,
  existing: readonly PodStandingMatchInput[],
  fill: "scheduled" | "cancelled",
  firstSequence: number
): PodStandingMatchInput[] {
  const matches = [...existing];
  const pairCounts = new Map<string, number>();
  for (const match of matches) {
    const key = pairKey(match.teams[0].teamId, match.teams[1].teamId);
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  let sequence = firstSequence;
  for (let left = 1; left <= teamCount; left += 1) {
    for (let right = left + 1; right <= teamCount; right += 1) {
      const key = pairKey(sanitizedTeamId(left), sanitizedTeamId(right));
      for (
        let count = pairCounts.get(key) ?? 0;
        count < gamesPerPair;
        count += 1
      ) {
        matches.push(fill === "scheduled"
          ? sanitizedBlockingMatch(sequence, left, right, "scheduled")
          : sanitizedCancelledMatch(sequence, left, right));
        sequence += 1;
      }
    }
  }
  return matches;
}

export function sanitizedTeamId(sequence: number): TournamentTeamId {
  return parseStableUuid(uuid(100 + sequence), "tournament_team");
}

export function sanitizedFinalMatch(
  sequence: number,
  leftTeam: number,
  rightTeam: number,
  leftScore: number,
  rightScore: number,
  shooting?: Readonly<{
    leftMakes: number;
    leftAttempts: number;
    rightMakes: number;
    rightAttempts: number;
  }>
): PodStandingMatchInput {
  if (leftScore === rightScore) {
    throw new Error("Sanitized final fixture requires a winner.");
  }
  return resolvedMatch(sequence, "final", "complete", [
    team(
      leftTeam,
      leftScore > rightScore ? "win" : "loss",
      leftScore,
      shooting?.leftMakes ?? leftScore,
      shooting?.leftAttempts ?? Math.max(leftScore, 1),
      leftScore,
      rightScore
    ),
    team(
      rightTeam,
      rightScore > leftScore ? "win" : "loss",
      rightScore,
      shooting?.rightMakes ?? rightScore,
      shooting?.rightAttempts ?? Math.max(rightScore, 1),
      rightScore,
      leftScore
    )
  ]);
}

export function sanitizedForfeitMatch(
  sequence: number,
  winningTeam: number,
  forfeitedTeam: number
): PodStandingMatchInput {
  return resolvedMatch(sequence, "forfeited", "not_applicable", [
    team(winningTeam, "win", null, 0, 0, 0, 0),
    team(forfeitedTeam, "forfeited", null, 0, 0, 0, 0)
  ]);
}

export function sanitizedCancelledMatch(
  sequence: number,
  leftTeam: number,
  rightTeam: number
): PodStandingMatchInput {
  return resolvedMatch(sequence, "cancelled", "not_applicable", [
    team(leftTeam, "cancelled", null, 0, 0, 0, 0),
    team(rightTeam, "cancelled", null, 0, 0, 0, 0)
  ]);
}

export function sanitizedBlockingMatch(
  sequence: number,
  leftTeam: number,
  rightTeam: number,
  status: "scheduled" | "postponed" | "in_progress" | "final"
): PodStandingMatchInput {
  const availability = availabilityForBlockingStatus(status);
  const input: PodStandingMatchInput = {
    matchId: parseStableUuid(uuid(1_000 + sequence), "match"),
    status,
    scoreAvailability: availability,
    teams: [
      team(leftTeam, "pending", availability === "partial" ? 0 : null, 0, 0, 0, 0),
      team(rightTeam, "pending", availability === "partial" ? 0 : null, 0, 0, 0, 0)
    ],
    ...(status === "scheduled" ? {} : provenance(sequence))
  };
  return input;
}

export function sanitizedTieResolution(
  sequence: number,
  tieGroupId: string,
  orderedTeams: readonly number[]
): PodStandingTieResolution {
  return {
    resolutionId: uuid(4_000 + sequence),
    tieGroupId,
    orderedTeamIds: orderedTeams.map(sanitizedTeamId),
    reason: "Sanitized administrator tie resolution.",
    resolvedBy: uuid(5_000),
    resolvedAt: SANITIZED_STANDINGS_NOW
  };
}

function resolvedMatch(
  sequence: number,
  status: Extract<MatchStatus, "final" | "forfeited" | "cancelled">,
  scoreAvailability: Extract<ScoreAvailability, "complete" | "not_applicable">,
  teams: PodStandingMatchInput["teams"]
): PodStandingMatchInput {
  return {
    matchId: parseStableUuid(uuid(1_000 + sequence), "match"),
    ...provenance(sequence),
    status,
    scoreAvailability,
    teams
  };
}

function provenance(sequence: number) {
  return {
    revisionId: parseStableUuid(uuid(2_000 + sequence), "match_revision"),
    statisticRunId: uuid(3_000 + sequence),
    statisticInputDigest: sequence.toString(16).padStart(64, "0")
  };
}

function team(
  teamSequence: number,
  result: PodStandingTeamResult,
  score: number | null,
  makes: number,
  attempts: number,
  cupsScored: number,
  cupsAgainst: number
) {
  return {
    teamId: sanitizedTeamId(teamSequence),
    result,
    score,
    makes,
    attempts,
    cupsScored,
    cupsAgainst
  };
}

function availabilityForBlockingStatus(
  status: "scheduled" | "postponed" | "in_progress" | "final"
): Extract<ScoreAvailability, "not_started" | "partial" | "unrecorded"> {
  if (status === "in_progress") {
    return "partial";
  }
  return status === "final" ? "unrecorded" : "not_started";
}

function pairKey(left: TournamentTeamId, right: TournamentTeamId): string {
  return [left, right].sort().join(":");
}

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}
