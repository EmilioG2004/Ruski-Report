import { Pod, Standing, TournamentId } from "../../domain";
import { PostgresExecutor } from "./postgres-executor";
import { writeJson, writeOptionalJson } from "./postgres-values";

export async function writeTournamentStructure(
  executor: PostgresExecutor,
  tournamentId: TournamentId,
  snapshotVersion: number,
  pods: readonly Pod[],
  standings: readonly Standing[]
): Promise<void> {
  for (const pod of pods) {
    await executor.query(
      `
        INSERT INTO pods (
          tournament_id, snapshot_version, pod_id, name, sequence, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        tournamentId,
        snapshotVersion,
        pod.id,
        pod.name,
        pod.sequence,
        writeJson(pod.metadata ?? {})
      ]
    );

    await writePodMembers(executor, tournamentId, snapshotVersion, pod);
  }

  for (const standing of standings) {
    await executor.query(
      `
        INSERT INTO standings (
          tournament_id, snapshot_version, standing_id, scope, team_id,
          pod_id, rank, record, games_played, points, metric_values, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        tournamentId,
        snapshotVersion,
        standing.id,
        standing.scope,
        standing.teamId,
        standing.podId ?? null,
        standing.rank,
        writeJson(standing.record),
        standing.gamesPlayed,
        standing.points ?? null,
        writeOptionalJson(standing.metricValues),
        writeJson(standing.metadata ?? {})
      ]
    );
  }
}

async function writePodMembers(
  executor: PostgresExecutor,
  tournamentId: TournamentId,
  snapshotVersion: number,
  pod: Pod
): Promise<void> {
  for (const [index, teamId] of pod.teamIds.entries()) {
    await executor.query(
      `
        INSERT INTO pod_teams (
          tournament_id, snapshot_version, pod_id, team_id, sequence
        ) VALUES ($1, $2, $3, $4, $5)
      `,
      [tournamentId, snapshotVersion, pod.id, teamId, index + 1]
    );
  }

  for (const [index, matchId] of (pod.matchIds ?? []).entries()) {
    await executor.query(
      `
        INSERT INTO pod_matches (
          tournament_id, snapshot_version, pod_id, match_id, sequence
        ) VALUES ($1, $2, $3, $4, $5)
      `,
      [tournamentId, snapshotVersion, pod.id, matchId, index + 1]
    );
  }
}
