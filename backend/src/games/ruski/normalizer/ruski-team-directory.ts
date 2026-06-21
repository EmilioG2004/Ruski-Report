import {
  Metadata,
  Player,
  PlayerId,
  Pod,
  Team,
  TeamId,
  TeamSeed,
  TournamentId
} from "../../../domain";
import { ParsedScorebookSide } from "../../parsed-scorebook";
import {
  createStableId,
  createTeamKey,
  createTeamName,
  getLastName,
  normalizeName
} from "./ruski-id";

export interface RuskiConfirmedTeam {
  id?: TeamId;
  name: string;
  players: readonly string[];
  seed?: TeamSeed;
  podId?: string;
  podName?: string;
  metadata?: Metadata;
}

export interface RuskiTeamResolution {
  team: Team;
  playerIds: PlayerId[];
}

interface TeamEntry {
  team: Team;
  playerIdsByName: Map<string, PlayerId>;
  podId?: string;
  podName?: string;
}

export class RuskiTeamDirectory {
  private readonly entriesByKey = new Map<string, TeamEntry>();
  private readonly entriesByTeamId = new Map<TeamId, TeamEntry>();

  constructor(
    private readonly tournamentId: TournamentId,
    confirmedTeams: readonly RuskiConfirmedTeam[] = []
  ) {
    confirmedTeams.forEach((team) => this.addConfirmedTeam(team));
  }

  resolveSide(side: ParsedScorebookSide): RuskiTeamResolution {
    const playerNames = side.players.map((player) => player.name);
    const key = createTeamKey(playerNames);
    const existing = this.entriesByKey.get(key);

    if (existing !== undefined) {
      return {
        team: existing.team,
        playerIds: playerNames.flatMap((name) =>
          existing.playerIdsByName.get(normalizeName(name)) ?? []
        )
      };
    }

    const team = createTeamFromNames(this.tournamentId, playerNames);
    const entry = createEntry(team);
    this.entriesByKey.set(key, entry);
    this.entriesByTeamId.set(team.id, entry);

    return {
      team,
      playerIds: team.players.map((player) => player.id)
    };
  }

  resolveShooter(
    teamId: TeamId,
    shooterName: string | null
  ): PlayerId | undefined {
    if (shooterName === null) {
      return undefined;
    }

    const entry = this.entriesByTeamId.get(teamId);

    if (entry === undefined) {
      return undefined;
    }

    const normalizedShooter = normalizeName(shooterName);
    const directMatch = entry.playerIdsByName.get(normalizedShooter);

    if (directMatch !== undefined) {
      return directMatch;
    }

    return entry.team.players.find((player) => {
      return normalizeName(getLastName(player.displayName)) === normalizedShooter;
    })?.id;
  }

  getTeams(): Team[] {
    return [...this.entriesByTeamId.values()].map((entry) => entry.team);
  }

  buildPods(
    matchIds: readonly string[],
    standingIdsByTeamId: ReadonlyMap<TeamId, string>
  ): Pod[] {
    const teams = this.getTeams();

    return [
      {
        id: "pod-confirmed-teams",
        tournamentId: this.tournamentId,
        name: "Confirmed Teams",
        sequence: 1,
        teamIds: teams.map((team) => team.id),
        matchIds: [...matchIds],
        standingIds: teams.flatMap((team) =>
          standingIdsByTeamId.get(team.id) ?? []
        ),
        metadata: {
          source: "season-team-directory"
        }
      }
    ];
  }

  private addConfirmedTeam(confirmedTeam: RuskiConfirmedTeam): void {
    const team = createTeamFromNames(
      this.tournamentId,
      confirmedTeam.players,
      confirmedTeam
    );
    const entry = createEntry(team, confirmedTeam);

    this.entriesByKey.set(createTeamKey(confirmedTeam.players), entry);
    this.entriesByTeamId.set(team.id, entry);
  }
}

function createTeamFromNames(
  tournamentId: TournamentId,
  playerNames: readonly string[],
  confirmedTeam?: RuskiConfirmedTeam
): Team {
  const players = playerNames.map(createPlayer);
  const teamName = confirmedTeam?.name ?? createTeamName(playerNames);

  return {
    id: confirmedTeam?.id ?? createStableId("team", createTeamKey(playerNames)),
    tournamentId,
    name: teamName,
    seed: confirmedTeam?.seed,
    players,
    metadata: {
      source:
        confirmedTeam === undefined
          ? "game-sheet-derived-team"
          : "season-confirmed-team",
      ...confirmedTeam?.metadata
    }
  };
}

function createPlayer(displayName: string): Player {
  return {
    id: createStableId("player", displayName),
    displayName
  };
}

function createEntry(
  team: Team,
  confirmedTeam?: RuskiConfirmedTeam
): TeamEntry {
  return {
    team,
    playerIdsByName: new Map(
      team.players.map((player) => [normalizeName(player.displayName), player.id])
    ),
    podId: confirmedTeam?.podId,
    podName: confirmedTeam?.podName
  };
}
