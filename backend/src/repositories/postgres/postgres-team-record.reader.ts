import { Metadata, Player, Team, TeamSeed } from "../../domain";
import { PostgresDatabase } from "../../database";
import { readOptionalJson } from "./postgres-values";

interface TeamRow {
  team_id: string;
  name: string;
  seed: unknown | null;
  metadata: unknown;
}

interface TeamPlayerRow {
  team_id: string;
  player_id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  metadata: unknown;
}

export async function readTeamRecords(
  database: PostgresDatabase,
  tournamentId: string,
  version: number
): Promise<Team[]> {
  const [teamResult, playerResult] = await Promise.all([
    database.query<TeamRow>(
      `
        SELECT team_id, name, seed, metadata
        FROM teams
        WHERE tournament_id = $1 AND snapshot_version = $2
        ORDER BY sequence
      `,
      [tournamentId, version]
    ),
    database.query<TeamPlayerRow>(
      `
        SELECT membership.team_id, player.*
        FROM team_players membership
        JOIN players player
          ON player.tournament_id = membership.tournament_id
         AND player.snapshot_version = membership.snapshot_version
         AND player.player_id = membership.player_id
        WHERE membership.tournament_id = $1
          AND membership.snapshot_version = $2
        ORDER BY membership.team_id, membership.sequence
      `,
      [tournamentId, version]
    )
  ]);
  const playersByTeam = groupBy(playerResult.rows, (row) => row.team_id);

  return teamResult.rows.map((row) => ({
    id: row.team_id,
    tournamentId,
    name: row.name,
    seed: readOptionalJson<TeamSeed>(row.seed),
    players: (playersByTeam.get(row.team_id) ?? []).map(mapPlayer),
    metadata: readOptionalJson<Metadata>(row.metadata)
  }));
}

function mapPlayer(row: TeamPlayerRow): Player {
  return {
    id: row.player_id,
    displayName: row.display_name,
    firstName: row.first_name ?? undefined,
    lastName: row.last_name ?? undefined,
    preferredName: row.preferred_name ?? undefined,
    metadata: readOptionalJson<Metadata>(row.metadata)
  };
}

function groupBy<T>(
  values: readonly T[],
  key: (value: T) => string
): Map<string, T[]> {
  return values.reduce((groups, value) => {
    const groupKey = key(value);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), value]);
    return groups;
  }, new Map<string, T[]>());
}
