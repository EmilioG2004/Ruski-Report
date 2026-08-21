import { createHash } from "node:crypto";

import {
  CopiedTournamentConfiguration,
  TournamentConfigurationValidationIssue,
  validateTournamentConfiguration,
  validateTournamentSetup
} from "../configuration";
import { TournamentSetup } from "../domain";
import {
  generatePodRoundRobinSchedule,
  ScheduledPodMatch
} from "../scheduling";

export interface TournamentSetupPreview {
  readonly valid: boolean;
  readonly issues: readonly TournamentConfigurationValidationIssue[];
  readonly matches: readonly ScheduledPodMatch[];
  readonly digest: string | null;
}

export function createTournamentSetupPreview(
  configuration: CopiedTournamentConfiguration,
  setup: TournamentSetup,
  rowVersion: number
): TournamentSetupPreview {
  const issues = [
    ...validateTournamentConfiguration(configuration).errors,
    ...validateTournamentSetup(configuration, setup).errors
  ];

  if (issues.length > 0) {
    return { valid: false, issues, matches: [], digest: null };
  }

  const matches = generatePodRoundRobinSchedule(configuration, setup);
  return {
    valid: true,
    issues: [],
    matches,
    digest: digestPreview(configuration, setup, rowVersion, matches)
  };
}

function digestPreview(
  configuration: CopiedTournamentConfiguration,
  setup: TournamentSetup,
  rowVersion: number,
  matches: readonly ScheduledPodMatch[]
): string {
  const canonical = {
    tournamentId: setup.tournamentId,
    rowVersion,
    configuration: {
      formatVersion: configuration.formatVersion,
      formatType: configuration.formatType,
      teamCount: configuration.teamCount,
      podCount: configuration.podCount,
      podSizes: [...configuration.podSizes],
      playersPerTeam: configuration.playersPerTeam,
      gamesPerPair: configuration.gamesPerPair,
      qualifiersPerPod: configuration.qualifiersPerPod,
      bracketSize: configuration.bracketSize,
      allowByes: configuration.allowByes,
      standingsRules: [...configuration.standingsRules],
      copiedFromPresetId: configuration.copiedFromPresetId ?? null
    },
    teams: [...setup.teams]
      .sort((first, second) => first.id.localeCompare(second.id))
      .map((team) => ({
        id: team.id,
        name: team.name,
        playerIds: [...team.playerIds]
      })),
    pods: [...setup.pods]
      .sort((first, second) => first.sequence - second.sequence)
      .map((pod) => ({
        id: pod.id,
        name: pod.name,
        sequence: pod.sequence,
        teamAssignments: [...pod.teamAssignments]
          .sort((first, second) => first.initialSeed - second.initialSeed)
          .map((assignment) => ({
            teamId: assignment.teamId,
            initialSeed: assignment.initialSeed
          }))
      })),
    matches: matches.map((match) => ({
      id: match.id,
      podId: match.podId,
      sequence: match.sequence,
      sequenceInPod: match.sequenceInPod,
      roundNumber: match.roundNumber,
      gameNumberForPair: match.gameNumberForPair,
      participantTeamIds: [...match.participantTeamIds],
      scheduledAt: match.scheduledAt
    }))
  };

  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}
