import { TournamentFormatConfiguration } from "../configuration/types";
import {
  TournamentConfigurationValidationIssue,
  validateTournamentConfiguration,
  validateTournamentSetup
} from "../configuration/validation";
import {
  MatchId,
  PodId,
  TournamentId,
  TournamentTeamId
} from "../domain/ids";
import {
  MatchStatus,
  ScoreAvailability
} from "../domain/match";
import {
  TournamentPodSetup,
  TournamentSetup
} from "../domain/setup";
import { createStablePodMatchId } from "./match-identity";

export interface ScheduledPodMatch {
  readonly id: MatchId;
  readonly tournamentId: TournamentId;
  readonly podId: PodId;
  readonly stage: "pod_play";
  readonly sequence: number;
  readonly sequenceInPod: number;
  readonly roundNumber: number;
  readonly gameNumberForPair: number;
  readonly participantTeamIds: readonly [
    TournamentTeamId,
    TournamentTeamId
  ];
  readonly status: Extract<MatchStatus, "scheduled">;
  readonly scoreAvailability: Extract<ScoreAvailability, "not_started">;
  readonly scheduledAt: string | null;
}

export class TournamentScheduleValidationError extends Error {
  constructor(
    readonly issues: readonly TournamentConfigurationValidationIssue[]
  ) {
    super("Tournament configuration and setup must be valid before scheduling.");
    this.name = "TournamentScheduleValidationError";
  }
}

export function generatePodRoundRobinSchedule(
  configuration: TournamentFormatConfiguration,
  setup: TournamentSetup
): ScheduledPodMatch[] {
  const configurationValidation =
    validateTournamentConfiguration(configuration);
  const setupValidation = validateTournamentSetup(configuration, setup);
  const issues = [
    ...configurationValidation.errors,
    ...setupValidation.errors
  ];

  if (issues.length > 0) {
    throw new TournamentScheduleValidationError(issues);
  }

  let sequence = 1;
  const schedule: ScheduledPodMatch[] = [];

  [...setup.pods]
    .sort((first, second) => first.sequence - second.sequence)
    .forEach((pod) => {
      let sequenceInPod = 1;
      const pairings = createPodPairings(pod);

      for (
        let gameNumberForPair = 1;
        gameNumberForPair <= configuration.gamesPerPair;
        gameNumberForPair += 1
      ) {
        pairings.forEach((roundPairings, roundIndex) => {
          roundPairings.forEach((participantTeamIds) => {
            schedule.push({
              id: createStablePodMatchId({
                tournamentId: setup.tournamentId,
                podId: pod.id,
                participantTeamIds,
                gameNumberForPair
              }),
              tournamentId: setup.tournamentId,
              podId: pod.id,
              stage: "pod_play",
              sequence,
              sequenceInPod,
              roundNumber:
                (gameNumberForPair - 1) * pairings.length + roundIndex + 1,
              gameNumberForPair,
              participantTeamIds,
              status: "scheduled",
              scoreAvailability: "not_started",
              scheduledAt: null
            });
            sequence += 1;
            sequenceInPod += 1;
          });
        });
      }
    });

  return schedule;
}

function createPodPairings(
  pod: TournamentPodSetup
): Array<Array<readonly [TournamentTeamId, TournamentTeamId]>> {
  const seededAssignments = [...pod.teamAssignments]
    .sort((first, second) => first.initialSeed - second.initialSeed);
  const seedByTeamId = new Map(
    seededAssignments.map((assignment) => [
      assignment.teamId,
      assignment.initialSeed
    ])
  );
  const participants: Array<TournamentTeamId | null> = seededAssignments
    .map((assignment) => assignment.teamId);

  if (participants.length % 2 !== 0) {
    participants.push(null);
  }

  const rounds: Array<Array<readonly [
    TournamentTeamId,
    TournamentTeamId
  ]>> = [];
  let rotation = participants;

  for (let roundIndex = 0; roundIndex < participants.length - 1; roundIndex += 1) {
    const pairings: Array<readonly [
      TournamentTeamId,
      TournamentTeamId
    ]> = [];

    for (let index = 0; index < rotation.length / 2; index += 1) {
      const first = rotation[index];
      const second = rotation[rotation.length - 1 - index];

      if (first !== null && second !== null) {
        pairings.push(orderByInitialSeed(first, second, seedByTeamId));
      }
    }

    rounds.push(pairings.sort((first, second) =>
      comparePairings(first, second, seedByTeamId)
    ));
    rotation = [
      rotation[0],
      rotation[rotation.length - 1],
      ...rotation.slice(1, -1)
    ];
  }

  return rounds;
}

function orderByInitialSeed(
  first: TournamentTeamId,
  second: TournamentTeamId,
  seedByTeamId: ReadonlyMap<TournamentTeamId, number>
): readonly [TournamentTeamId, TournamentTeamId] {
  return requireSeed(first, seedByTeamId) < requireSeed(second, seedByTeamId)
    ? [first, second]
    : [second, first];
}

function comparePairings(
  first: readonly [TournamentTeamId, TournamentTeamId],
  second: readonly [TournamentTeamId, TournamentTeamId],
  seedByTeamId: ReadonlyMap<TournamentTeamId, number>
): number {
  return requireSeed(first[0], seedByTeamId) -
      requireSeed(second[0], seedByTeamId) ||
    requireSeed(first[1], seedByTeamId) -
      requireSeed(second[1], seedByTeamId);
}

function requireSeed(
  teamId: TournamentTeamId,
  seedByTeamId: ReadonlyMap<TournamentTeamId, number>
): number {
  const seed = seedByTeamId.get(teamId);
  if (seed === undefined) {
    throw new Error(`Missing initial seed for team '${teamId}'.`);
  }
  return seed;
}
