import {
  PodId,
  TournamentId,
  TournamentPlayerId,
  TournamentTeamId
} from "./ids";

export interface TournamentSetupTeam {
  readonly id: TournamentTeamId;
  readonly name: string;
  readonly playerIds: readonly TournamentPlayerId[];
}

export interface TournamentPodTeamAssignment {
  readonly teamId: TournamentTeamId;
  readonly initialSeed: number;
}

export interface TournamentPodSetup {
  readonly id: PodId;
  readonly name: string;
  readonly sequence: number;
  readonly teamAssignments: readonly TournamentPodTeamAssignment[];
}

export interface TournamentSetup {
  readonly tournamentId: TournamentId;
  readonly teams: readonly TournamentSetupTeam[];
  readonly pods: readonly TournamentPodSetup[];
}
