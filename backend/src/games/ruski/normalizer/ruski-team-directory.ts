import {
  Metadata,
  Player,
  PlayerId,
  Team,
  TeamId,
  TeamSeed,
  TournamentId
} from "../../../domain";
import { ParsedScorebookSheet } from "../../parsed-scorebook";
import { createStableId, getLastName, normalizeName } from "./ruski-id";
import {
  RuskiCanonicalTeamIdentity,
  RuskiTeamIdentityCandidate,
  RuskiTeamIdentityResolver
} from "./ruski-team-identity-resolver";
import { RuskiTournamentSource } from "./ruski-tournament-source";

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

interface CanonicalTeamEntry extends RuskiTeamIdentityCandidate {
  team: Team;
}

export class RuskiTeamDirectory {
  private readonly entries: CanonicalTeamEntry[];
  private readonly entriesByTeamId = new Map<TeamId, CanonicalTeamEntry>();
  private readonly playersById = new Map<PlayerId, Player>();
  private readonly playerIdsByName = new Map<string, PlayerId>();

  constructor(
    private readonly tournamentId: TournamentId,
    source: RuskiTournamentSource,
    confirmedTeams: readonly RuskiConfirmedTeam[] = [],
    private readonly identityResolver = new RuskiTeamIdentityResolver()
  ) {
    this.entries = identityResolver
      .buildCanonicalIdentities(source)
      .map((identity) => this.createCanonicalEntry(identity, confirmedTeams));
    this.entries.forEach((entry) => {
      this.entriesByTeamId.set(entry.team.id, entry);
      entry.players.forEach((player) => this.registerPlayer(player));
    });
    source.seasonPlayerStatistics.forEach((row) =>
      this.registerPlayer(createPlayer(row.subjectLabel))
    );
    source.playoffPlayerStatistics.forEach((row) =>
      this.registerPlayer(createPlayer(row.subjectLabel))
    );
  }

  resolveGameSheet(sheet: ParsedScorebookSheet): RuskiTeamResolution[] {
    const teamIds = this.identityResolver.resolveGameSheet(sheet, this.entries);

    return teamIds.map((teamId, index) => {
      const entry = this.entriesByTeamId.get(teamId);
      if (entry === undefined) {
        throw new Error(`Identity resolver returned unknown team '${teamId}'.`);
      }

      return {
        team: entry.team,
        playerIds: sheet.game?.sides[index].players.map((player) =>
          this.requirePlayerId(player.name)
        ) ?? []
      };
    });
  }

  resolveTeamLabel(label: string): Team | undefined {
    const teamId = this.identityResolver.resolveTeamLabel(label, this.entries);
    return teamId === undefined ? undefined : this.entriesByTeamId.get(teamId)?.team;
  }

  resolveShooter(teamId: TeamId, shooterName: string | null): PlayerId | undefined {
    if (shooterName === null) {
      return undefined;
    }

    const directMatch = this.playerIdsByName.get(normalizeName(shooterName));
    if (directMatch !== undefined) {
      return directMatch;
    }

    const normalizedShooter = normalizeName(shooterName);
    const teamPlayer = this.entriesByTeamId.get(teamId)?.players.find(
      (player) => normalizeName(getLastName(player.displayName)) === normalizedShooter
    );
    if (teamPlayer !== undefined) {
      return teamPlayer.id;
    }

    const surnameMatches = [...this.playersById.values()].filter(
      (player) => normalizeName(getLastName(player.displayName)) === normalizedShooter
    );
    return surnameMatches.length === 1 ? surnameMatches[0].id : undefined;
  }

  getPlayer(playerId: PlayerId): Player | undefined {
    return this.playersById.get(playerId);
  }

  getTeams(): Team[] {
    return this.entries.map((entry) => entry.team);
  }

  findTeamIdForPlayer(playerId: PlayerId): TeamId | undefined {
    return this.entries.find((entry) =>
      entry.players.some((player) => player.id === playerId)
    )?.team.id;
  }

  private createCanonicalEntry(
    identity: RuskiCanonicalTeamIdentity,
    confirmedTeams: readonly RuskiConfirmedTeam[]
  ): CanonicalTeamEntry {
    const confirmed = findConfirmedTeam(confirmedTeams, identity.playerNames);
    const players = identity.playerNames.map(createPlayer);
    const team: Team = {
      id: confirmed?.id ?? createStableId("team", identity.sourceName),
      tournamentId: this.tournamentId,
      name: confirmed?.name ?? identity.sourceName,
      seed: confirmed?.seed ?? {
        pod: identity.seed,
        label: String(identity.seed)
      },
      players,
      metadata: {
        source: confirmed === undefined
          ? "regular-season-standings"
          : "season-confirmed-team",
        sourceName: identity.sourceName,
        aliases: identity.aliases,
        ...confirmed?.metadata
      }
    };

    return {
      teamId: team.id,
      team,
      aliases: identity.aliases,
      players
    };
  }

  private registerPlayer(player: Player): void {
    this.playersById.set(player.id, player);
    this.playerIdsByName.set(normalizeName(player.displayName), player.id);
  }

  private requirePlayerId(displayName: string): PlayerId {
    const player = createPlayer(displayName);
    this.registerPlayer(player);
    return player.id;
  }
}

function findConfirmedTeam(
  confirmedTeams: readonly RuskiConfirmedTeam[],
  playerNames: readonly string[]
): RuskiConfirmedTeam | undefined {
  const playerKey = playerNames.map(normalizeName).sort().join("|");
  return confirmedTeams.find(
    (team) => team.players.map(normalizeName).sort().join("|") === playerKey
  );
}

function createPlayer(displayName: string): Player {
  return {
    id: createStableId("player", displayName),
    displayName
  };
}
