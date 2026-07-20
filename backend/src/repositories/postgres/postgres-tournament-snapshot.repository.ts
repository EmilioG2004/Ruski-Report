import { Injectable } from "@nestjs/common";

import { PostgresDatabase } from "../../database";
import { TournamentSnapshot } from "../../games";
import {
  repositoryFailure,
  repositorySuccess,
  RepositoryResult
} from "../repository-result";
import {
  PublishSnapshotResult,
  TournamentSnapshotRepository
} from "../tournament-snapshot-repository";
import { TransactionContext } from "../transaction";
import { selectPostgresExecutor } from "./postgres-executor";
import { writeMatchSnapshot } from "./postgres-match-snapshot.writer";
import { mapPostgresError } from "./postgres-repository-error";
import { writeScorebookSource } from "./postgres-scorebook-source.writer";
import { writeTeamSnapshot } from "./postgres-team-snapshot.writer";
import { writeTournamentStructure } from "./postgres-tournament-structure.writer";

@Injectable()
export class PostgresTournamentSnapshotRepository
  implements TournamentSnapshotRepository
{
  constructor(private readonly database: PostgresDatabase) {}

  async publishSnapshot(
    snapshot: TournamentSnapshot,
    transaction: TransactionContext
  ): Promise<RepositoryResult<PublishSnapshotResult>> {
    try {
      const executor = selectPostgresExecutor(this.database, transaction);
      const tournament = snapshot.tournament;
      await executor.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [tournament.id]
      );
      const previousVersion = await findActiveVersion(executor, tournament.id);
      const snapshotVersion = Math.max(
        tournament.version,
        (previousVersion ?? 0) + 1
      );
      const publishedAt = new Date().toISOString();
      const sourceId = readSourceId(snapshot, snapshotVersion);

      await upsertTournament(executor, snapshot);
      await writeScorebookSource(executor, sourceId, snapshot.source);
      await writeSnapshotVersion(
        executor,
        snapshot,
        sourceId,
        snapshotVersion,
        publishedAt
      );
      await writeTeamSnapshot(
        executor,
        tournament.id,
        snapshotVersion,
        tournament.teams
      );
      await writeMatchSnapshot(
        executor,
        tournament.id,
        snapshotVersion,
        snapshot.matches
      );
      await writeTournamentStructure(
        executor,
        tournament.id,
        snapshotVersion,
        tournament.pods,
        tournament.standings
      );
      await activateSnapshot(
        executor,
        tournament.id,
        snapshotVersion,
        publishedAt
      );

      return repositorySuccess({
        status: "published",
        snapshotVersion: {
          tournamentId: tournament.id,
          gameType: tournament.gameType,
          version: snapshotVersion,
          publishedAt,
          previousVersion
        }
      });
    } catch (error) {
      return repositoryFailure(
        mapPostgresError(error, "Failed to publish tournament snapshot.")
      );
    }
  }
}

async function findActiveVersion(
  executor: ReturnType<typeof selectPostgresExecutor>,
  tournamentId: string
): Promise<number | undefined> {
  const result = await executor.query<{ snapshot_version: number }>(
    `
      SELECT snapshot_version
      FROM active_tournament_snapshots
      WHERE tournament_id = $1
    `,
    [tournamentId]
  );
  return result.rows[0]?.snapshot_version;
}

async function upsertTournament(
  executor: ReturnType<typeof selectPostgresExecutor>,
  snapshot: TournamentSnapshot
): Promise<void> {
  const tournament = snapshot.tournament;
  await executor.query(
    `
      INSERT INTO tournaments (id, game_type, year, name)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET
        game_type = EXCLUDED.game_type,
        year = EXCLUDED.year,
        name = EXCLUDED.name
    `,
    [tournament.id, tournament.gameType, tournament.year, tournament.name]
  );
}

async function writeSnapshotVersion(
  executor: ReturnType<typeof selectPostgresExecutor>,
  snapshot: TournamentSnapshot,
  sourceId: string,
  snapshotVersion: number,
  publishedAt: string
): Promise<void> {
  const tournament = snapshot.tournament;
  await executor.query(
    `
      INSERT INTO tournament_snapshot_versions (
        tournament_id, version, status, format, active_match_ids,
        featured_match_ids, bracket, statistics, metadata, game_definition,
        validation, source_id, generated_at, published_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15
      )
    `,
    [
      tournament.id,
      snapshotVersion,
      tournament.status,
      tournament.format,
      tournament.activeMatchIds,
      tournament.featuredMatchIds,
      tournament.bracket ?? null,
      tournament.statistics ?? null,
      tournament.metadata ?? {},
      snapshot.gameDefinition,
      snapshot.validation,
      sourceId,
      snapshot.generatedAt,
      publishedAt,
      tournament.updatedAt
    ]
  );
}

async function activateSnapshot(
  executor: ReturnType<typeof selectPostgresExecutor>,
  tournamentId: string,
  snapshotVersion: number,
  publishedAt: string
): Promise<void> {
  await executor.query(
    `
      INSERT INTO active_tournament_snapshots (
        tournament_id, snapshot_version, activated_at
      ) VALUES ($1, $2, $3)
      ON CONFLICT (tournament_id) DO UPDATE SET
        snapshot_version = EXCLUDED.snapshot_version,
        activated_at = EXCLUDED.activated_at
    `,
    [tournamentId, snapshotVersion, publishedAt]
  );
}

function readSourceId(
  snapshot: TournamentSnapshot,
  snapshotVersion: number
): string {
  const uploadId = snapshot.source.metadata?.uploadId;
  return typeof uploadId === "string" && uploadId.length > 0
    ? uploadId
    : `${snapshot.tournament.id}-snapshot-${snapshotVersion}`;
}
