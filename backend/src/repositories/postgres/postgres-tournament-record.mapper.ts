import {
  Bracket,
  CommentsSummary,
  GameEvent,
  GamePhase,
  MatchDetail,
  MatchParticipant,
  MatchScore,
  MatchStatus,
  MatchSummary,
  Metadata,
  Pod,
  Standing,
  Team,
  Tournament,
  TournamentFormat,
  TournamentStatisticTable,
  TournamentStatus,
  TournamentSummary
} from "../../domain";
import { BoxScore } from "../../domain/box-score";
import { Scorecard } from "../../domain/scorecard";
import {
  readISOString,
  readJson,
  readOptionalJson
} from "./postgres-values";

export interface SnapshotHeaderRow {
  id: string;
  game_type: string;
  year: number;
  name: string;
  status: TournamentStatus;
  format: unknown;
  active_match_ids: string[];
  featured_match_ids: string[];
  bracket: unknown | null;
  statistics: unknown | null;
  metadata: unknown;
  snapshot_version: number;
  updated_at: Date | string;
}

export interface MatchRecordRow {
  match_id: string;
  tournament_id: string;
  game_type: string;
  status: MatchStatus;
  participants: unknown;
  score: unknown;
  pod_id: string | null;
  bracket_match_id: string | null;
  current_phase: unknown | null;
  scheduled_at: Date | string | null;
  started_at: Date | string | null;
  ended_at: Date | string | null;
  metadata: unknown;
  box_score: unknown;
  scorecard: unknown;
  events: unknown;
  comments_summary: unknown | null;
  domain_version: number;
  updated_at: Date | string;
}

export function mapTournamentSummary(
  row: SnapshotHeaderRow
): TournamentSummary {
  return {
    id: row.id,
    year: row.year,
    name: row.name,
    gameType: row.game_type,
    status: row.status,
    format: readJson<TournamentFormat>(row.format),
    activeMatchIds: row.active_match_ids,
    featuredMatchIds: row.featured_match_ids,
    metadata: readOptionalJson<Metadata>(row.metadata),
    version: row.snapshot_version,
    updatedAt: readISOString(row.updated_at)
  };
}

export function mapTournament(
  row: SnapshotHeaderRow,
  teams: Team[],
  pods: Pod[],
  standings: Standing[],
  matches: MatchSummary[]
): Tournament {
  return {
    ...mapTournamentSummary(row),
    teams,
    pods,
    standings,
    bracket: readOptionalJson<Bracket>(row.bracket),
    matchSummaries: matches,
    statistics: readOptionalJson<TournamentStatisticTable[]>(row.statistics)
  };
}

export function mapMatchSummary(row: MatchRecordRow): MatchSummary {
  return {
    id: row.match_id,
    tournamentId: row.tournament_id,
    gameType: row.game_type,
    status: row.status,
    participants: readJson<MatchParticipant[]>(row.participants),
    score: readJson<MatchScore>(row.score),
    podId: row.pod_id ?? undefined,
    bracketMatchId: row.bracket_match_id ?? undefined,
    currentPhase: readOptionalJson<GamePhase>(row.current_phase),
    scheduledAt: readOptionalISOString(row.scheduled_at),
    startedAt: readOptionalISOString(row.started_at),
    endedAt: readOptionalISOString(row.ended_at),
    metadata: readOptionalJson<Metadata>(row.metadata),
    version: row.domain_version,
    updatedAt: readISOString(row.updated_at)
  };
}

export function mapMatchDetail(row: MatchRecordRow): MatchDetail {
  return {
    ...mapMatchSummary(row),
    boxScore: readJson<BoxScore>(row.box_score),
    scorecard: readJson<Scorecard>(row.scorecard),
    events: readJson<GameEvent[]>(row.events),
    commentsSummary: readOptionalJson<CommentsSummary>(row.comments_summary)
  };
}

function readOptionalISOString(
  value: Date | string | null
): string | undefined {
  return value === null ? undefined : readISOString(value);
}
