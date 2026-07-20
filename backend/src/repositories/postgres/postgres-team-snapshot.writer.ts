import { Team, TournamentId } from "../../domain";
import { PostgresExecutor } from "./postgres-executor";

export async function writeTeamSnapshot(
  executor: PostgresExecutor,
  tournamentId: TournamentId,
  snapshotVersion: number,
  teams: readonly Team[]
): Promise<void> {
  for (const [teamIndex, team] of teams.entries()) {
    await executor.query(
      `
        INSERT INTO teams (
          tournament_id, snapshot_version, team_id, name, sequence, seed, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        tournamentId,
        snapshotVersion,
        team.id,
        team.name,
        teamIndex + 1,
        team.seed ?? null,
        team.metadata ?? {}
      ]
    );

    for (const [index, player] of team.players.entries()) {
      await executor.query(
        `
          INSERT INTO players (
            tournament_id, snapshot_version, player_id, display_name,
            first_name, last_name, preferred_name, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (tournament_id, snapshot_version, player_id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            preferred_name = EXCLUDED.preferred_name,
            metadata = EXCLUDED.metadata
        `,
        [
          tournamentId,
          snapshotVersion,
          player.id,
          player.displayName,
          player.firstName ?? null,
          player.lastName ?? null,
          player.preferredName ?? null,
          player.metadata ?? {}
        ]
      );
      await executor.query(
        `
          INSERT INTO team_players (
            tournament_id, snapshot_version, team_id, player_id, sequence
          ) VALUES ($1, $2, $3, $4, $5)
        `,
        [tournamentId, snapshotVersion, team.id, player.id, index + 1]
      );
    }
  }
}
