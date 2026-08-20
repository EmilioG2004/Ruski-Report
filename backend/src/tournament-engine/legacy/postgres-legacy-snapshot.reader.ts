import { QueryResultRow } from "pg";

import { PostgresDatabase } from "../../database/postgres-database";
import { LegacySnapshotReader } from "./legacy-backfill.repository";
import {
  LegacyBracketSource,
  LegacyMatchParticipantSource,
  LegacyMatchScoreSource,
  LegacyMatchStatus,
  LegacyTournamentSource
} from "./legacy-backfill.types";

interface HeaderRow extends QueryResultRow {
  legacy_tournament_id: string;
  game_type: string;
  year: number;
  name: string;
  snapshot_version: number;
  status: string;
  format: unknown;
  metadata: unknown;
  bracket: unknown | null;
  published_at: Date | string;
}

interface TeamRow extends QueryResultRow {
  team_id: string;
  name: string;
  sequence: number;
  seed: unknown | null;
}

interface PlayerRow extends QueryResultRow {
  player_id: string;
  display_name: string;
}

interface RosterRow extends QueryResultRow {
  team_id: string;
  player_id: string;
  sequence: number;
}

interface PodRow extends QueryResultRow {
  pod_id: string;
  name: string;
  sequence: number;
}

interface PodMemberRow extends QueryResultRow {
  pod_id: string;
  member_id: string;
}

interface MatchRow extends QueryResultRow {
  match_id: string;
  sequence: number;
  status: string;
  pod_id: string | null;
  bracket_match_id: string | null;
  participants: unknown;
  score: unknown;
  metadata: unknown;
  updated_at: Date | string;
}

interface StandingRow extends QueryResultRow {
  standing_id: string;
  scope: "pod" | "tournament";
  team_id: string;
  pod_id: string | null;
  rank: number;
  record: unknown;
  games_played: number;
  points: number | null;
  metric_values: unknown | null;
}

interface MatchIdentityRow extends QueryResultRow {
  match_id: string;
  comment_ids: string[];
  report_ids: string[];
}

export class PostgresLegacySnapshotReader implements LegacySnapshotReader {
  constructor(private readonly database: PostgresDatabase) {}

  async readActiveSnapshot(
    legacyTournamentId: string
  ): Promise<LegacyTournamentSource | null> {
    const headerResult = await this.database.query<HeaderRow>(
      `
        SELECT tournament.id AS legacy_tournament_id,
               tournament.game_type,
               tournament.year,
               tournament.name,
               snapshot.version AS snapshot_version,
               snapshot.status,
               snapshot.format,
               snapshot.metadata,
               snapshot.bracket,
               snapshot.published_at
        FROM active_tournament_snapshots active
        JOIN tournament_snapshot_versions snapshot
          ON snapshot.tournament_id = active.tournament_id
         AND snapshot.version = active.snapshot_version
        JOIN tournaments tournament
          ON tournament.id = active.tournament_id
        WHERE tournament.id = $1
          AND tournament.year = 2026
      `,
      [legacyTournamentId]
    );
    const header = headerResult.rows[0];
    if (header === undefined) {
      return null;
    }

    const version = header.snapshot_version;
    const tournamentId = header.legacy_tournament_id;
    const [
      teamResult,
      playerResult,
      rosterResult,
      podResult,
      podTeamResult,
      podMatchResult,
      matchResult,
      standingResult,
      identityResult
    ] = await Promise.all([
      this.database.query<TeamRow>(
        `SELECT team_id, name, sequence, seed
         FROM teams
         WHERE tournament_id = $1 AND snapshot_version = $2
         ORDER BY sequence, team_id`,
        [tournamentId, version]
      ),
      this.database.query<PlayerRow>(
        `SELECT player_id, display_name
         FROM players
         WHERE tournament_id = $1 AND snapshot_version = $2
         ORDER BY player_id`,
        [tournamentId, version]
      ),
      this.database.query<RosterRow>(
        `SELECT team_id, player_id, sequence
         FROM team_players
         WHERE tournament_id = $1 AND snapshot_version = $2
         ORDER BY team_id, sequence, player_id`,
        [tournamentId, version]
      ),
      this.database.query<PodRow>(
        `SELECT pod_id, name, sequence
         FROM pods
         WHERE tournament_id = $1 AND snapshot_version = $2
         ORDER BY sequence, pod_id`,
        [tournamentId, version]
      ),
      this.database.query<PodMemberRow>(
        `SELECT pod_id, team_id AS member_id
         FROM pod_teams
         WHERE tournament_id = $1 AND snapshot_version = $2
         ORDER BY pod_id, sequence, team_id`,
        [tournamentId, version]
      ),
      this.database.query<PodMemberRow>(
        `SELECT pod_id, match_id AS member_id
         FROM pod_matches
         WHERE tournament_id = $1 AND snapshot_version = $2
         ORDER BY pod_id, sequence, match_id`,
        [tournamentId, version]
      ),
      this.database.query<MatchRow>(
        `SELECT match_id, sequence, status, pod_id, bracket_match_id,
                participants, score, metadata, updated_at
         FROM matches
         WHERE tournament_id = $1 AND snapshot_version = $2
         ORDER BY sequence, match_id`,
        [tournamentId, version]
      ),
      this.database.query<StandingRow>(
        `SELECT standing_id, scope, team_id, pod_id, rank, record,
                games_played, points, metric_values
         FROM standings
         WHERE tournament_id = $1 AND snapshot_version = $2
         ORDER BY standing_id`,
        [tournamentId, version]
      ),
      this.database.query<MatchIdentityRow>(
        `
          SELECT identity.match_id,
                 COALESCE(
                   array_agg(DISTINCT comment.id)
                     FILTER (WHERE comment.id IS NOT NULL),
                   '{}'::text[]
                 ) AS comment_ids,
                 COALESCE(
                   array_agg(DISTINCT report.id)
                     FILTER (WHERE report.id IS NOT NULL),
                   '{}'::text[]
                 ) AS report_ids
          FROM match_identities identity
          LEFT JOIN comments comment ON comment.match_id = identity.match_id
          LEFT JOIN comment_reports report ON report.match_id = identity.match_id
          WHERE identity.tournament_id = $1
            AND NOT EXISTS (
              SELECT 1
              FROM engine_matches engine_match
              WHERE engine_match.public_key = identity.match_id
                AND engine_match.metadata ->> 'compatibilityIdentity' = 'true'
            )
          GROUP BY identity.match_id
          ORDER BY identity.match_id
        `,
        [tournamentId]
      )
    ]);

    const podTeams = groupMembers(podTeamResult.rows);
    const podMatches = groupMembers(podMatchResult.rows);

    return {
      legacyTournamentId: tournamentId,
      snapshotVersion: version,
      snapshotPublishedAt: toISOString(header.published_at),
      year: header.year,
      name: header.name,
      gameType: header.game_type,
      status: header.status,
      format: readObject(header.format, "tournament format"),
      metadata: readObject(header.metadata, "tournament metadata"),
      teams: teamResult.rows.map((row) => {
        const seed = readOptionalObject(row.seed, "team seed");
        return {
          legacyTeamId: row.team_id,
          name: row.name,
          sequence: row.sequence,
          podSeed: readOptionalInteger(seed, "pod"),
          overallSeed: readOptionalInteger(seed, "overall")
        };
      }),
      players: playerResult.rows.map((row) => ({
        legacyPlayerId: row.player_id,
        displayName: row.display_name
      })),
      rosterMemberships: rosterResult.rows.map((row) => ({
        legacyTeamId: row.team_id,
        legacyPlayerId: row.player_id,
        sequence: row.sequence
      })),
      pods: podResult.rows.map((row) => ({
        legacyPodId: row.pod_id,
        name: row.name,
        sequence: row.sequence,
        legacyTeamIds: podTeams.get(row.pod_id) ?? [],
        legacyMatchIds: podMatches.get(row.pod_id) ?? []
      })),
      matches: matchResult.rows.map((row) => ({
        legacyMatchId: row.match_id,
        sequence: row.sequence,
        status: readMatchStatus(row.status),
        legacyPodId: row.pod_id ?? undefined,
        legacyBracketMatchId: row.bracket_match_id ?? undefined,
        participants: readParticipants(row.participants),
        score: readScore(row.score),
        detailAvailability: readDetailAvailability(row.metadata),
        updatedAt: toISOString(row.updated_at)
      })),
      standings: standingResult.rows.map((row) => {
        const record = readObject(row.record, "standing record");
        return {
          legacyStandingId: row.standing_id,
          legacyTeamId: row.team_id,
          legacyPodId: row.pod_id ?? undefined,
          scope: row.scope,
          rank: row.rank,
          wins: readInteger(record, "wins"),
          losses: readInteger(record, "losses"),
          gamesPlayed: row.games_played,
          points: row.points ?? undefined,
          metricValues: readMetricValues(row.metric_values)
        };
      }),
      bracket: readBracket(header.bracket),
      matchIdentities: identityResult.rows.map((row) => ({
        legacyMatchId: row.match_id,
        commentIds: [...row.comment_ids].sort(),
        reportIds: [...row.report_ids].sort()
      }))
    };
  }
}

function groupMembers(rows: readonly PodMemberRow[]): Map<string, string[]> {
  return rows.reduce((groups, row) => {
    groups.set(row.pod_id, [...(groups.get(row.pod_id) ?? []), row.member_id]);
    return groups;
  }, new Map<string, string[]>());
}

function readParticipants(value: unknown): LegacyMatchParticipantSource[] {
  return readArray(value, "match participants").map((item) => {
    const participant = readObject(item, "match participant");
    return {
      legacyTeamId: readString(participant, "teamId"),
      legacyPlayerIds: readOptionalStringArray(participant, "playerIds"),
      seed: readOptionalInteger(participant, "seed"),
      score: readOptionalNumber(participant, "score"),
      result: readParticipantResult(participant.result)
    };
  });
}

function readScore(value: unknown): LegacyMatchScoreSource {
  const score = readObject(value, "match score");
  const metadata = readOptionalObject(score.metadata, "match score metadata");
  return {
    participants: readArray(score.participants, "match team scores").map(
      (item) => {
        const teamScore = readObject(item, "match team score");
        return {
          legacyTeamId: readString(teamScore, "teamId"),
          score: readNumber(teamScore, "score")
        };
      }
    ),
    legacyWinnerTeamId: readOptionalString(score, "winnerTeamId"),
    isFinal: readBoolean(score, "isFinal"),
    availability: metadata?.availability === "unrecorded"
      ? "unrecorded"
      : metadata === undefined
        ? undefined
        : "recorded"
  };
}

function readDetailAvailability(
  value: unknown
): "recorded" | "unrecorded" | undefined {
  const metadata = readObject(value, "match metadata");
  return metadata.detailAvailability === "bracket-only"
    ? "unrecorded"
    : undefined;
}

function readBracket(value: unknown | null): LegacyBracketSource | undefined {
  if (value === null) {
    return undefined;
  }
  const bracket = readObject(value, "bracket");
  return {
    legacyBracketId: readString(bracket, "id"),
    name: readOptionalString(bracket, "name") ?? "Legacy Playoff Bracket",
    rounds: readArray(bracket.rounds, "bracket rounds").map((roundValue) => {
      const round = readObject(roundValue, "bracket round");
      return {
        legacyRoundId: readString(round, "id"),
        name: readString(round, "name"),
        sequence: readInteger(round, "sequence"),
        matches: readArray(round.matches, "bracket matches").map(
          (matchValue) => {
            const match = readObject(matchValue, "bracket match");
            return {
              legacyBracketMatchId: readString(match, "id"),
              legacyMatchId: readOptionalString(match, "matchId"),
              sequence: readInteger(match, "sequence"),
              status: readBracketStatus(match.status),
              slots: readArray(match.slots, "bracket slots").map(
                (slotValue, index) => {
                  const slot = readObject(slotValue, "bracket slot");
                  const source = readOptionalObject(slot.source, "bracket slot source");
                  return {
                    sequence: index + 1,
                    seed: readOptionalInteger(slot, "seed"),
                    legacyTeamId: readOptionalString(slot, "teamId"),
                    sourceType: readBracketSourceType(source?.type),
                    legacySourceBracketMatchId: source === undefined
                      ? undefined
                      : readOptionalString(source, "sourceMatchId"),
                    label: source === undefined
                      ? undefined
                      : readOptionalString(source, "label")
                  };
                }
              ),
              legacyWinnerTeamId: readOptionalString(match, "winnerTeamId")
            };
          }
        )
      };
    })
  };
}

function readMetricValues(value: unknown | null): Record<string, number | null> {
  const values = readOptionalObject(value, "standing metric values") ?? {};
  return Object.entries(values).reduce<Record<string, number | null>>(
    (result, [key, item]) => {
      if (item !== null && typeof item !== "number") {
        throw new Error(`Legacy standing metric '${key}' is not numeric.`);
      }
      result[key] = item;
      return result;
    },
    {}
  );
}

function readMatchStatus(value: string): LegacyMatchStatus {
  switch (value) {
    case "scheduled":
    case "in_progress":
    case "final":
    case "postponed":
    case "cancelled":
    case "forfeited":
      return value;
    default:
      throw new Error(`Legacy match status '${value}' is unsupported.`);
  }
}

function readBracketStatus(
  value: unknown
): "scheduled" | "in_progress" | "completed" | "pending" {
  if (
    value === "scheduled" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "pending"
  ) {
    return value;
  }
  throw new Error("Legacy bracket match status is unsupported.");
}

function readBracketSourceType(
  value: unknown
): "team" | "match-winner" | "match-loser" | "bye" | "tbd" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "team" ||
    value === "match-winner" ||
    value === "match-loser" ||
    value === "bye" ||
    value === "tbd"
  ) {
    return value;
  }
  throw new Error("Legacy bracket slot source type is unsupported.");
}

function readParticipantResult(
  value: unknown
): "win" | "loss" | "tie" | "pending" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "win" ||
    value === "loss" ||
    value === "tie" ||
    value === "pending"
  ) {
    return value;
  }
  throw new Error("Legacy match participant result is unsupported.");
}

function readArray(value: unknown, label: string): unknown[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) {
    throw new Error(`Legacy ${label} is not an array.`);
  }
  return parsed;
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  const parsed = parseJson(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Legacy ${label} is not an object.`);
  }
  return parsed as Record<string, unknown>;
}

function readOptionalObject(
  value: unknown,
  label: string
): Record<string, unknown> | undefined {
  return value === null || value === undefined ? undefined : readObject(value, label);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  return JSON.parse(value) as unknown;
}

function readString(value: Record<string, unknown>, key: string): string {
  const item = value[key];
  if (typeof item !== "string" || item.length === 0) {
    throw new Error(`Legacy field '${key}' is not a non-empty string.`);
  }
  return item;
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string
): string | undefined {
  const item = value[key];
  if (item === null || item === undefined) {
    return undefined;
  }
  if (typeof item !== "string") {
    throw new Error(`Legacy field '${key}' is not a string.`);
  }
  return item;
}

function readOptionalStringArray(
  value: Record<string, unknown>,
  key: string
): string[] {
  const item = value[key];
  if (item === null || item === undefined) {
    return [];
  }
  return readArray(item, key).map((entry) => {
    if (typeof entry !== "string") {
      throw new Error(`Legacy field '${key}' contains a non-string value.`);
    }
    return entry;
  });
}

function readNumber(value: Record<string, unknown>, key: string): number {
  const item = value[key];
  if (typeof item !== "number" || !Number.isFinite(item)) {
    throw new Error(`Legacy field '${key}' is not numeric.`);
  }
  return item;
}

function readOptionalNumber(
  value: Record<string, unknown>,
  key: string
): number | undefined {
  const item = value[key];
  if (item === null || item === undefined) {
    return undefined;
  }
  return readNumber(value, key);
}

function readInteger(value: Record<string, unknown>, key: string): number {
  const item = readNumber(value, key);
  if (!Number.isInteger(item)) {
    throw new Error(`Legacy field '${key}' is not an integer.`);
  }
  return item;
}

function readOptionalInteger(
  value: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  if (value === undefined || value[key] === null || value[key] === undefined) {
    return undefined;
  }
  return readInteger(value, key);
}

function readBoolean(value: Record<string, unknown>, key: string): boolean {
  const item = value[key];
  if (typeof item !== "boolean") {
    throw new Error(`Legacy field '${key}' is not boolean.`);
  }
  return item;
}

function toISOString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
