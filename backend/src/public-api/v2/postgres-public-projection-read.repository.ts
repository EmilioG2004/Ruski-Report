import { PostgresDatabase } from "../../database";
import {
  CanonicalMatchDetailEnvelope,
  CanonicalMatchListEnvelope,
  CanonicalPublicMatch,
  CanonicalPublicMatchSummary,
  CanonicalPublicProjectionRef,
  CanonicalPublicTournament,
  CanonicalPublicTournamentSummary,
  CanonicalTournamentDetailEnvelope,
  CanonicalTournamentDiscoveryItem,
  PUBLIC_PROJECTION_CONTRACT_VERSION
} from "../../tournament-engine/public-projection";
import {
  PublicProjectionReadRepository,
  VisiblePublicMatchReference
} from "./public-projection-read.repository";
import { publicProjectionReadFailure } from "./public-v2.errors";

interface DiscoveryRow {
  tournament_public_key: string;
  projection_version: string | number;
  activated_at: Date | string;
  tournament_summary: unknown;
}

interface TournamentRow {
  tournament_public_key: string;
  projection_version: string | number;
  activated_at: Date | string;
  tournament_detail: unknown;
}

interface MatchListRow {
  tournament_public_key: string;
  projection_version: string | number;
  activated_at: Date | string;
  match_summaries: unknown;
}

interface MatchRow {
  tournament_public_key: string;
  projection_version: string | number;
  activated_at: Date | string;
  detail_payload: unknown;
}

interface ExistsRow {
  present: boolean;
}

interface VisibleMatchReferenceRow {
  match_public_key: string;
  tournament_public_key: string;
  projection_version: string | number;
}

export class PostgresPublicProjectionReadRepository
implements PublicProjectionReadRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async listActiveTournaments(): Promise<
    readonly CanonicalTournamentDiscoveryItem[]
  > {
    try {
      const result = await this.database.query<DiscoveryRow>(`
        SELECT payload.tournament_public_key,
               payload.projection_version,
               active.activated_at,
               payload.tournament_summary
        FROM engine_public_tournament_projection_payloads payload
        JOIN engine_active_projection_versions active
          ON active.tournament_id = payload.tournament_id
         AND active.projection_version = payload.projection_version
        JOIN engine_projection_versions projection
          ON projection.tournament_id = payload.tournament_id
         AND projection.version = payload.projection_version
         AND projection.status = 'active'
        WHERE payload.visibility = 'public'
          AND payload.lifecycle IN (
            'setup_published', 'pod_play', 'seeding_review', 'playoffs'
          )
        ORDER BY payload.year DESC,
                 active.activated_at DESC,
                 payload.tournament_public_key
      `);

      return result.rows.map((row) => ({
        projection: projectionRef(row),
        tournament: row.tournament_summary as CanonicalPublicTournamentSummary
      }));
    } catch (error) {
      throw publicProjectionReadFailure(error);
    }
  }

  async hasPublicTournament(tournamentId: string): Promise<boolean> {
    try {
      const result = await this.database.query<ExistsRow>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM engine_public_tournament_projection_payloads payload
            JOIN engine_projection_versions projection
              ON projection.tournament_id = payload.tournament_id
             AND projection.version = payload.projection_version
            WHERE payload.tournament_public_key = $1
              AND payload.visibility = 'public'
              AND projection.status IN ('active', 'superseded')
              AND projection.activated_at IS NOT NULL
          ) AS present
        `,
        [tournamentId]
      );
      return result.rows[0]?.present === true;
    } catch (error) {
      throw publicProjectionReadFailure(error);
    }
  }

  async findTournament(
    tournamentId: string,
    projectionVersion?: number
  ): Promise<CanonicalTournamentDetailEnvelope | null> {
    try {
      const result = await this.database.query<TournamentRow>(
        `${tournamentSelection(projectionVersion)}
         SELECT payload.tournament_public_key,
                payload.projection_version,
                selected.activated_at,
                payload.tournament_detail
         FROM engine_public_tournament_projection_payloads payload
         JOIN selected_projection selected
           ON selected.tournament_id = payload.tournament_id
          AND selected.projection_version = payload.projection_version
         WHERE payload.tournament_public_key = $1
           AND payload.visibility = 'public'`,
        selectionValues(tournamentId, projectionVersion)
      );
      const row = result.rows[0];
      if (row === undefined) {
        return null;
      }

      return {
        contractVersion: PUBLIC_PROJECTION_CONTRACT_VERSION,
        projection: projectionRef(row),
        tournament: row.tournament_detail as CanonicalPublicTournament
      };
    } catch (error) {
      throw publicProjectionReadFailure(error);
    }
  }

  async findTournamentMatches(
    tournamentId: string,
    projectionVersion?: number
  ): Promise<CanonicalMatchListEnvelope | null> {
    try {
      const result = await this.database.query<MatchListRow>(
        `${tournamentSelection(projectionVersion)}
         SELECT payload.tournament_public_key,
                payload.projection_version,
                selected.activated_at,
                COALESCE((
                  SELECT jsonb_agg(
                    match.summary_payload
                    ORDER BY
                      CASE match.summary_payload->>'stage'
                        WHEN 'pod_play' THEN 0
                        ELSE 1
                      END,
                      (match.summary_payload->>'sequence')::integer,
                      (match.summary_payload->>'instance')::integer,
                      match.match_public_key
                  )
                  FROM engine_public_match_projection_payloads match
                  WHERE match.tournament_id = payload.tournament_id
                    AND match.projection_version = payload.projection_version
                ), '[]'::jsonb) AS match_summaries
         FROM engine_public_tournament_projection_payloads payload
         JOIN selected_projection selected
           ON selected.tournament_id = payload.tournament_id
          AND selected.projection_version = payload.projection_version
         WHERE payload.tournament_public_key = $1
           AND payload.visibility = 'public'`,
        selectionValues(tournamentId, projectionVersion)
      );
      const row = result.rows[0];
      if (row === undefined) {
        return null;
      }

      return {
        contractVersion: PUBLIC_PROJECTION_CONTRACT_VERSION,
        projection: projectionRef(row),
        matches: row.match_summaries as readonly CanonicalPublicMatchSummary[]
      };
    } catch (error) {
      throw publicProjectionReadFailure(error);
    }
  }

  async findMatch(
    matchId: string,
    projectionVersion?: number
  ): Promise<CanonicalMatchDetailEnvelope | null> {
    try {
      const result = await this.database.query<MatchRow>(
        `${matchSelection(projectionVersion)}
         SELECT tournament.tournament_public_key,
                match.projection_version,
                selected.activated_at,
                match.detail_payload
         FROM engine_public_match_projection_payloads match
         JOIN engine_public_tournament_projection_payloads tournament
           ON tournament.tournament_id = match.tournament_id
          AND tournament.projection_version = match.projection_version
         JOIN selected_projection selected
           ON selected.tournament_id = match.tournament_id
          AND selected.projection_version = match.projection_version
         WHERE match.match_public_key = $1
           AND tournament.visibility = 'public'`,
        selectionValues(matchId, projectionVersion)
      );
      const row = result.rows[0];
      if (row === undefined) {
        return null;
      }

      return {
        contractVersion: PUBLIC_PROJECTION_CONTRACT_VERSION,
        projection: projectionRef(row),
        match: row.detail_payload as CanonicalPublicMatch
      };
    } catch (error) {
      throw publicProjectionReadFailure(error);
    }
  }

  async findVisibleMatchReference(
    matchId: string
  ): Promise<VisiblePublicMatchReference | null> {
    try {
      const result = await this.database.query<VisibleMatchReferenceRow>(
        `
          SELECT match.match_public_key,
                 tournament.tournament_public_key,
                 match.projection_version
          FROM engine_public_match_projection_payloads match
          JOIN engine_public_tournament_projection_payloads tournament
            ON tournament.tournament_id = match.tournament_id
           AND tournament.projection_version = match.projection_version
          JOIN engine_active_projection_versions active
            ON active.tournament_id = match.tournament_id
           AND active.projection_version = match.projection_version
          JOIN engine_projection_versions projection
            ON projection.tournament_id = match.tournament_id
           AND projection.version = match.projection_version
           AND projection.status = 'active'
          WHERE match.match_public_key = $1
            AND tournament.visibility = 'public'
        `,
        [matchId]
      );
      const row = result.rows[0];
      return row === undefined
        ? null
        : {
            matchId: row.match_public_key,
            tournamentId: row.tournament_public_key,
            projectionVersion: Number(row.projection_version)
          };
    } catch (error) {
      throw publicProjectionReadFailure(error);
    }
  }
}

function tournamentSelection(projectionVersion: number | undefined): string {
  if (projectionVersion === undefined) {
    return `
      WITH selected_projection AS (
        SELECT active.tournament_id,
               active.projection_version,
               active.activated_at
        FROM engine_active_projection_versions active
        JOIN engine_projection_versions projection
          ON projection.tournament_id = active.tournament_id
         AND projection.version = active.projection_version
         AND projection.status = 'active'
      )`;
  }

  return `
    WITH selected_projection AS (
      SELECT projection.tournament_id,
             projection.version AS projection_version,
             projection.activated_at
      FROM engine_projection_versions projection
      WHERE projection.version = $2
        AND projection.status IN ('active', 'superseded')
        AND projection.activated_at IS NOT NULL
    )`;
}

function matchSelection(projectionVersion: number | undefined): string {
  return tournamentSelection(projectionVersion);
}

function selectionValues(
  publicId: string,
  projectionVersion: number | undefined
): readonly unknown[] {
  return projectionVersion === undefined
    ? [publicId]
    : [publicId, projectionVersion];
}

function projectionRef(row: {
  tournament_public_key: string;
  projection_version: string | number;
  activated_at: Date | string;
}): CanonicalPublicProjectionRef {
  return {
    tournamentId: row.tournament_public_key,
    version: Number(row.projection_version),
    activatedAt: isoTimestamp(row.activated_at),
    source: "canonical"
  };
}

function isoTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}
