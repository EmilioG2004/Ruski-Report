import {
  Metadata,
  Pod,
  Standing,
  TeamRecord
} from "../../domain";
import { PostgresDatabase } from "../../database";
import { readJson, readOptionalJson } from "./postgres-values";

interface PodRow {
  pod_id: string;
  name: string;
  sequence: number;
  metadata: unknown;
}

interface PodMemberRow {
  pod_id: string;
  member_id: string;
}

interface StandingRow {
  standing_id: string;
  scope: Standing["scope"];
  team_id: string;
  pod_id: string | null;
  rank: number;
  record: unknown;
  games_played: number;
  points: number | null;
  metric_values: unknown | null;
  metadata: unknown;
}

export async function readPodRecords(
  database: PostgresDatabase,
  tournamentId: string,
  version: number
): Promise<Pod[]> {
  const [podResult, teamResult, matchResult, standingResult] =
    await Promise.all([
      database.query<PodRow>(
        `SELECT pod_id, name, sequence, metadata FROM pods
         WHERE tournament_id = $1 AND snapshot_version = $2
         ORDER BY sequence`,
        [tournamentId, version]
      ),
      readPodMembers(database, "pod_teams", "team_id", tournamentId, version),
      readPodMembers(
        database,
        "pod_matches",
        "match_id",
        tournamentId,
        version
      ),
      database.query<{ pod_id: string; standing_id: string }>(
        `SELECT pod_id, standing_id FROM standings
         WHERE tournament_id = $1 AND snapshot_version = $2 AND pod_id IS NOT NULL
         ORDER BY pod_id, rank`,
        [tournamentId, version]
      )
    ]);
  const teamsByPod = groupBy(teamResult, (row) => row.pod_id);
  const matchesByPod = groupBy(matchResult, (row) => row.pod_id);
  const standingsByPod = groupBy(standingResult.rows, (row) => row.pod_id);

  return podResult.rows.map((row) => ({
    id: row.pod_id,
    tournamentId,
    name: row.name,
    sequence: row.sequence,
    teamIds: (teamsByPod.get(row.pod_id) ?? []).map((item) => item.member_id),
    matchIds: (matchesByPod.get(row.pod_id) ?? []).map(
      (item) => item.member_id
    ),
    standingIds: (standingsByPod.get(row.pod_id) ?? []).map(
      (item) => item.standing_id
    ),
    metadata: readOptionalJson<Metadata>(row.metadata)
  }));
}

export async function readStandingRecords(
  database: PostgresDatabase,
  tournamentId: string,
  version: number
): Promise<Standing[]> {
  const result = await database.query<StandingRow>(
    `
      SELECT standing_id, scope, team_id, pod_id, rank, record,
             games_played, points, metric_values, metadata
      FROM standings
      WHERE tournament_id = $1 AND snapshot_version = $2
      ORDER BY pod_id NULLS LAST, rank
    `,
    [tournamentId, version]
  );

  return result.rows.map((row) => ({
    id: row.standing_id,
    tournamentId,
    scope: row.scope,
    teamId: row.team_id,
    podId: row.pod_id ?? undefined,
    rank: row.rank,
    record: readJson<TeamRecord>(row.record),
    gamesPlayed: row.games_played,
    points: row.points ?? undefined,
    metricValues: readOptionalJson<Record<string, number | null>>(
      row.metric_values
    ),
    metadata: readOptionalJson<Metadata>(row.metadata)
  }));
}

async function readPodMembers(
  database: PostgresDatabase,
  table: "pod_teams" | "pod_matches",
  memberColumn: "team_id" | "match_id",
  tournamentId: string,
  version: number
): Promise<PodMemberRow[]> {
  const result = await database.query<PodMemberRow>(
    `SELECT pod_id, ${memberColumn} AS member_id FROM ${table}
     WHERE tournament_id = $1 AND snapshot_version = $2
     ORDER BY pod_id, sequence`,
    [tournamentId, version]
  );
  return result.rows;
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
