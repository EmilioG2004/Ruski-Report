import { MatchDetail, TournamentId } from "../../domain";
import { PostgresExecutor } from "./postgres-executor";

export async function writeMatchSnapshot(
  executor: PostgresExecutor,
  tournamentId: TournamentId,
  snapshotVersion: number,
  matches: readonly MatchDetail[]
): Promise<void> {
  for (const [matchIndex, match] of matches.entries()) {
    await ensureMatchIdentity(executor, match.id, tournamentId);
    await executor.query(
      `
        INSERT INTO matches (
          tournament_id, snapshot_version, match_id, sequence, game_type, status,
          participants, score, pod_id, bracket_match_id, current_phase,
          scheduled_at, started_at, ended_at, metadata, box_score, scorecard,
          events, comments_summary, domain_version, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
        )
      `,
      [
        tournamentId,
        snapshotVersion,
        match.id,
        matchIndex + 1,
        match.gameType,
        match.status,
        match.participants,
        match.score,
        match.podId ?? null,
        match.bracketMatchId ?? null,
        match.currentPhase ?? null,
        match.scheduledAt ?? null,
        match.startedAt ?? null,
        match.endedAt ?? null,
        match.metadata ?? {},
        match.boxScore,
        match.scorecard,
        match.events,
        match.commentsSummary ?? null,
        match.version,
        match.updatedAt
      ]
    );
  }
}

async function ensureMatchIdentity(
  executor: PostgresExecutor,
  matchId: string,
  tournamentId: TournamentId
): Promise<void> {
  const result = await executor.query<{ tournament_id: string }>(
    `
      INSERT INTO match_identities (match_id, tournament_id)
      VALUES ($1, $2)
      ON CONFLICT (match_id) DO UPDATE SET match_id = EXCLUDED.match_id
      RETURNING tournament_id
    `,
    [matchId, tournamentId]
  );

  if (result.rows[0]?.tournament_id !== tournamentId) {
    throw new Error(
      `Match '${matchId}' is already associated with another tournament.`
    );
  }
}
