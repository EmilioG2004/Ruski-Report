import { Injectable } from "@nestjs/common";

import {
  MatchDetail,
  MatchSummary,
  Tournament
} from "../../domain";
import { PostgresDatabase } from "../../database";
import {
  repositoryFailure,
  repositorySuccess,
  RepositoryResult
} from "../repository-result";
import {
  ActiveTournamentQuery,
  TournamentReadRepository
} from "../tournament-read-repository";
import { mapPostgresError } from "./postgres-repository-error";
import { readMatchRecords } from "./postgres-match-record.reader";
import { readTeamRecords } from "./postgres-team-record.reader";
import {
  mapMatchDetail,
  mapMatchSummary,
  mapTournament,
  mapTournamentSummary,
  MatchRecordRow,
  SnapshotHeaderRow
} from "./postgres-tournament-record.mapper";
import {
  readPodRecords,
  readStandingRecords
} from "./postgres-tournament-structure.reader";

@Injectable()
export class PostgresTournamentReadRepository
  implements TournamentReadRepository
{
  constructor(private readonly database: PostgresDatabase) {}

  async findActiveTournament(
    query?: ActiveTournamentQuery
  ): Promise<RepositoryResult<ReturnType<typeof mapTournamentSummary> | null>> {
    try {
      const conditions: string[] = [];
      const values: unknown[] = [];

      if (query?.gameType !== undefined) {
        values.push(query.gameType);
        conditions.push(`tournament.game_type = $${values.length}`);
      }
      if (query?.year !== undefined) {
        values.push(query.year);
        conditions.push(`tournament.year = $${values.length}`);
      }

      const result = await this.database.query<SnapshotHeaderRow>(
        `${snapshotHeaderQuery}
         ${createWhereClause(conditions)}
         ORDER BY tournament.year DESC, snapshot.published_at DESC
         LIMIT 1`,
        values
      );
      const row = result.rows[0];
      return repositorySuccess(row === undefined ? null : mapTournamentSummary(row));
    } catch (error) {
      return this.failure(error, "Failed to read the active tournament.");
    }
  }

  async findTournamentById(
    tournamentId: string
  ): Promise<RepositoryResult<Tournament | null>> {
    try {
      const headerResult = await this.database.query<SnapshotHeaderRow>(
        `${snapshotHeaderQuery} WHERE tournament.id = $1`,
        [tournamentId]
      );
      const header = headerResult.rows[0];

      if (header === undefined) {
        return repositorySuccess(null);
      }

      const version = header.snapshot_version;
      const [teams, pods, standings, matches] = await Promise.all([
        readTeamRecords(this.database, tournamentId, version),
        readPodRecords(this.database, tournamentId, version),
        readStandingRecords(this.database, tournamentId, version),
        readMatchRecords(this.database, tournamentId, version)
      ]);

      return repositorySuccess(
        mapTournament(header, teams, pods, standings, matches.map(mapMatchSummary))
      );
    } catch (error) {
      return this.failure(error, "Failed to read tournament detail.");
    }
  }

  async findMatchesByTournamentId(
    tournamentId: string
  ): Promise<RepositoryResult<MatchSummary[]>> {
    try {
      const version = await this.findActiveVersion(tournamentId);
      if (version === undefined) {
        return repositorySuccess([]);
      }

      const rows = await readMatchRecords(this.database, tournamentId, version);
      return repositorySuccess(rows.map(mapMatchSummary));
    } catch (error) {
      return this.failure(error, "Failed to read tournament matches.");
    }
  }

  async findMatchDetail(
    matchId: string
  ): Promise<RepositoryResult<MatchDetail | null>> {
    try {
      const result = await this.database.query<MatchRecordRow>(
        `
          SELECT match_record.*
          FROM match_identities match_identity
          JOIN active_tournament_snapshots active
            ON active.tournament_id = match_identity.tournament_id
          JOIN matches match_record
            ON match_record.tournament_id = active.tournament_id
           AND match_record.snapshot_version = active.snapshot_version
           AND match_record.match_id = match_identity.match_id
          WHERE match_identity.match_id = $1
        `,
        [matchId]
      );
      const row = result.rows[0];
      return repositorySuccess(row === undefined ? null : mapMatchDetail(row));
    } catch (error) {
      return this.failure(error, "Failed to read match detail.");
    }
  }

  private async findActiveVersion(
    tournamentId: string
  ): Promise<number | undefined> {
    const result = await this.database.query<{ snapshot_version: number }>(
      `
        SELECT snapshot_version
        FROM active_tournament_snapshots
        WHERE tournament_id = $1
      `,
      [tournamentId]
    );
    return result.rows[0]?.snapshot_version;
  }

  private failure<T>(error: unknown, message: string): RepositoryResult<T> {
    return repositoryFailure(mapPostgresError(error, message));
  }
}

const snapshotHeaderQuery = `
  SELECT
    tournament.id,
    tournament.game_type,
    tournament.year,
    tournament.name,
    snapshot.status,
    snapshot.format,
    snapshot.active_match_ids,
    snapshot.featured_match_ids,
    snapshot.bracket,
    snapshot.statistics,
    snapshot.metadata,
    snapshot.version AS snapshot_version,
    snapshot.updated_at
  FROM active_tournament_snapshots active
  JOIN tournament_snapshot_versions snapshot
    ON snapshot.tournament_id = active.tournament_id
   AND snapshot.version = active.snapshot_version
  JOIN tournaments tournament ON tournament.id = active.tournament_id
`;

function createWhereClause(conditions: string[]): string {
  return conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
}
