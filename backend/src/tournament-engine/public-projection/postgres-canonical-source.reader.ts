import { EnginePostgresExecutor } from "../persistence/postgres-engine-executor";
import {
  EnginePersistenceConflictError,
  EnginePersistenceInvariantError
} from "../persistence/errors";
import {
  CanonicalPublicBoxScore,
  CanonicalPublicBracket,
  CanonicalPublicBracketMatch,
  CanonicalPublicBracketSlot,
  CanonicalPublicMatch,
  CanonicalPublicMatchEvent,
  CanonicalPublicMatchParticipant,
  CanonicalPublicMatchSummary,
  CanonicalPublicPod,
  CanonicalPublicRosterTeam,
  CanonicalPublicScorecard,
  CanonicalPublicSeed,
  CanonicalPublicStatistic,
  CanonicalPublicTournament,
  CanonicalPublicTournamentSummary,
  PublicMatchStatus,
  PublicScoreAvailability,
  PublicTournamentLifecycle
} from "./contracts";

interface TournamentRow {
  public_key: string;
  game_type: string;
  year: number;
  name: string;
  lifecycle: PublicTournamentLifecycle;
  visibility: "private" | "public";
  row_version: string | number;
  format_version: number;
  format_type: "pod_and_single_elimination";
  team_count: number;
  pod_count: number;
  pod_sizes: number[];
  players_per_team: number;
  games_per_pair: number;
  qualifiers_per_pod: number;
  bracket_size: number;
  allow_byes: boolean;
  standings_rules: CanonicalPublicTournament["format"]["standingsRules"];
  copied_from_preset_id: string | null;
}

interface PodRow {
  id: string;
  public_key: string;
  name: string;
  sequence: number;
  active_finalization_id: string | null;
  calculation_status: "provisional" | "unresolved_tie" | "finalizable" | null;
  finalized_at: string | Date | null;
}

interface RosterRow {
  team_public_key: string;
  team_name: string;
  team_sequence: number;
  pod_public_key: string;
  initial_seed: number;
  player_public_key: string | null;
  player_name: string | null;
  roster_slot: number | null;
}

interface StandingRow {
  pod_id: string;
  team_public_key: string;
  team_name: string;
  rank: number | null;
  wins: number;
  losses: number;
  cup_differential: number;
  makes: number | null;
  attempts: number | null;
  shooting_percentage: string | number | null;
  tie_group: string | null;
  administrator_resolution: string | null;
}

interface MatchRow {
  id: string;
  public_key: string;
  stage: "pod_play" | "playoffs";
  pod_public_key: string | null;
  sequence: number;
  status: PublicMatchStatus;
  score_availability: PublicScoreAvailability;
  scheduled_at: string | Date | null;
  started_at: string | Date | null;
  ended_at: string | Date | null;
  updated_at: string | Date;
  row_version: string | number;
  revision_number: number | null;
  revision_reason: string | null;
  correction_reason: string | null;
  previous_revision_number: number | null;
  bracket_match_public_key: string | null;
  instance_number: number;
  replaces_match_public_key: string | null;
  replaced_by_match_public_key: string | null;
  winner_public_key: string | null;
  winner_name: string | null;
}

interface ParticipantRow {
  match_id: string;
  side_number: 1 | 2;
  team_public_key: string;
  team_name: string;
  score: number | null;
  result: CanonicalPublicMatchParticipant["result"] | "pending";
  seed: number | null;
  player_public_key: string | null;
  player_name: string | null;
  roster_slot: number | null;
}

interface EventRow {
  match_id: string;
  event_public_key: string;
  sequence: number;
  event_type: string;
  team_public_key: string | null;
  player_public_key: string | null;
  player_name: string | null;
  side_number: 1 | 2 | null;
  occurred_at: string | Date | null;
  outcome: "make" | "miss" | null;
  cup_delta: number | null;
  phase: string | null;
  turn_number: number | null;
  team_turn_order: number | null;
  shot_in_team_turn: number | null;
  classification: string | null;
}

interface StatisticRow {
  scope: "match" | "pod" | "tournament";
  scope_public_key: string;
  stage: "pod" | "playoff" | "all";
  subject_type: "player" | "team";
  subject_public_key: string;
  subject_name: string;
  metric: string;
  value: string | number | null;
}

interface SeedRow {
  team_public_key: string;
  team_name: string;
  calculated_seed: number;
  effective_seed: number;
  override_id: string | null;
}

interface BracketRow {
  bracket_public_key: string;
  bracket_name: string;
  bracket_size: number;
  round_public_key: string;
  round_name: string;
  round_sequence: number;
  bracket_match_public_key: string;
  bracket_match_sequence: number;
  match_public_key: string | null;
  match_status: PublicMatchStatus | null;
  slot_number: 1 | 2;
  source_type: "team" | "match_winner" | "bye" | "tbd";
  team_public_key: string | null;
  team_name: string | null;
  source_bracket_match_public_key: string | null;
  seed: number | null;
  winner_public_key: string | null;
  winner_name: string | null;
  resolution_type: "match_result" | "structural_bye" | null;
  replacement_count: number;
  replaced_match_public_key: string | null;
}

export interface CanonicalPublicProjectionMatchSource {
  engineMatchId: string;
  sourceMatchRowVersion: number;
  summary: CanonicalPublicMatchSummary;
  detail: CanonicalPublicMatch;
}

export interface CanonicalPublicProjectionSource {
  tournamentRowVersion: number;
  visibility: "private" | "public";
  tournamentSummary: CanonicalPublicTournamentSummary;
  tournamentDetail: CanonicalPublicTournament;
  matches: readonly CanonicalPublicProjectionMatchSource[];
  sourcePointers: Readonly<Record<string, string>>;
}

export async function readCanonicalPublicProjectionSource(
  executor: EnginePostgresExecutor,
  tournamentId: string
): Promise<CanonicalPublicProjectionSource> {
  await lockSourcePointers(executor, tournamentId);
  await assertCoherentPointers(executor, tournamentId);
  const tournament = await readTournament(executor, tournamentId);
  const podRows = await readPods(executor, tournamentId);
  const rosterRows = await readRosters(executor, tournamentId);
  const standingRows = await readStandings(executor, tournamentId);
  const matchRows = await readMatches(executor, tournamentId);
  const participantRows = await readParticipants(executor, tournamentId);
  const eventRows = await readEvents(executor, tournamentId);
  const statisticRows = await readStatistics(executor, tournamentId);
  const seedRows = await readSeeds(executor, tournamentId);
  const bracketRows = await readBracket(executor, tournamentId);
  const sourcePointers = await readPointers(executor, tournamentId);
  const statistics = buildStatistics(statisticRows);
  const matches = matchRows.map((row) => {
    const detail = buildMatch(
      row,
      participantRows.filter((item) => item.match_id === row.id),
      eventRows.filter((item) => item.match_id === row.id),
      statistics.filter((item) =>
        item.scope === "match" && item.scopeId === row.public_key
      )
    );
    return {
      engineMatchId: row.id,
      sourceMatchRowVersion: Number(row.row_version),
      summary: toCanonicalMatchSummary(detail),
      detail
    };
  });
  const summary = toTournamentSummary(tournament);
  const detail: CanonicalPublicTournament = {
    ...summary,
    format: {
      formatVersion: tournament.format_version,
      formatType: tournament.format_type,
      teamCount: tournament.team_count,
      podCount: tournament.pod_count,
      podSizes: tournament.pod_sizes.map(Number),
      playersPerTeam: tournament.players_per_team,
      gamesPerPair: tournament.games_per_pair,
      qualifiersPerPod: tournament.qualifiers_per_pod,
      bracketSize: tournament.bracket_size,
      allowByes: tournament.allow_byes,
      standingsRules: tournament.standings_rules,
      ...(tournament.copied_from_preset_id === null
        ? {}
        : { copiedFromPresetId: tournament.copied_from_preset_id })
    },
    rosters: buildRosters(rosterRows),
    pods: buildPods(podRows, standingRows),
    seeds: seedRows.map(toSeed),
    statistics,
    matches: matches.map((item) => item.summary),
    bracket: buildBracket(bracketRows)
  };
  validateSource(detail, matches);
  return {
    tournamentRowVersion: Number(tournament.row_version),
    visibility: tournament.visibility,
    tournamentSummary: summary,
    tournamentDetail: detail,
    matches,
    sourcePointers
  };
}

async function lockSourcePointers(
  executor: EnginePostgresExecutor,
  tournamentId: string
): Promise<void> {
  const tables = [
    "engine_active_tournament_statistic_runs",
    "engine_active_pod_standing_calculations",
    "engine_active_tournament_standing_calculations",
    "engine_active_global_seed_reviews",
    "engine_active_seed_calculations",
    "engine_active_seed_override_commands",
    "engine_active_brackets",
    "engine_active_bracket_match_resolutions"
  ];
  for (const table of tables) {
    await executor.query(
      `SELECT tournament_id FROM ${table} WHERE tournament_id = $1::uuid FOR UPDATE`,
      [tournamentId]
    );
  }
  await executor.query(`
    SELECT id FROM engine_matches
    WHERE tournament_id = $1::uuid AND NOT identity_only
    ORDER BY id FOR SHARE
  `, [tournamentId]);
}

async function assertCoherentPointers(
  executor: EnginePostgresExecutor,
  tournamentId: string
): Promise<void> {
  const mismatch = (await executor.query<{ mismatch_count: string }>(`
    SELECT count(*)::text AS mismatch_count
    FROM engine_matches match
    JOIN engine_match_revisions revision ON revision.id = match.active_revision_id
    WHERE match.tournament_id = $1::uuid
      AND (revision.match_id <> match.id
        OR revision.status <> match.status
        OR revision.score_availability <> match.score_availability)
  `, [tournamentId])).rows[0]?.mismatch_count;
  if (mismatch !== "0") {
    throw new EnginePersistenceConflictError(
      "Active match revision pointers are not projection-coherent."
    );
  }
  const statistic = (await executor.query<{ run_kind: string }>(`
    SELECT scope.run_kind
    FROM engine_active_tournament_statistic_runs active
    JOIN engine_canonical_statistic_run_scopes scope
      ON scope.statistic_run_id = active.statistic_run_id
    WHERE active.tournament_id = $1::uuid
  `, [tournamentId])).rows[0];
  if (statistic !== undefined && statistic.run_kind !== "tournament_aggregate") {
    throw new EnginePersistenceConflictError(
      "Active tournament statistics do not reference an aggregate run."
    );
  }
  const winnerMismatch = (await executor.query<{ mismatch_count: string }>(`
    SELECT count(*)::text AS mismatch_count
    FROM engine_active_bracket_match_resolutions active
    JOIN engine_bracket_match_resolutions resolution
      ON resolution.id = active.resolution_id
    JOIN engine_bracket_matches node ON node.id = active.bracket_match_id
    JOIN engine_matches match ON match.id = node.match_id
    JOIN engine_match_revision_teams winning_team
      ON winning_team.revision_id = match.active_revision_id
     AND winning_team.result = 'win'
    WHERE active.tournament_id = $1::uuid
      AND resolution.resolution_type = 'match_result'
      AND resolution.winner_team_id <> winning_team.team_id
  `, [tournamentId])).rows[0]?.mismatch_count;
  if (winnerMismatch !== "0") {
    throw new EnginePersistenceConflictError(
      "Bracket resolution winner disagrees with the active match revision."
    );
  }
}

async function readTournament(
  executor: EnginePostgresExecutor,
  tournamentId: string
): Promise<TournamentRow> {
  const row = (await executor.query<TournamentRow>(`
    SELECT tournament.public_key, tournament.game_type, tournament.year,
           tournament.name, tournament.lifecycle, tournament.visibility,
           tournament.row_version, configuration.format_version,
           configuration.format_type, configuration.team_count,
           configuration.pod_count, configuration.pod_sizes,
           configuration.players_per_team, configuration.games_per_pair,
           configuration.qualifiers_per_pod, configuration.bracket_size,
           configuration.allow_byes, configuration.standings_rules,
           configuration.copied_from_preset_id
    FROM engine_tournaments tournament
    JOIN engine_tournament_configurations configuration
      ON configuration.tournament_id = tournament.id
    WHERE tournament.id = $1::uuid
  `, [tournamentId])).rows[0];
  if (row === undefined) {
    throw new EnginePersistenceInvariantError("Tournament source was not found.");
  }
  return row;
}

async function readPods(
  executor: EnginePostgresExecutor,
  tournamentId: string
): Promise<PodRow[]> {
  return (await executor.query<PodRow>(`
    SELECT pod.id::text, pod.public_key, pod.name, pod.sequence,
           pod.active_finalization_id::text, calculation.status AS calculation_status,
           finalization.finalized_at
    FROM engine_pods pod
    LEFT JOIN engine_active_pod_standing_calculations active
      ON active.tournament_id = pod.tournament_id AND active.pod_id = pod.id
    LEFT JOIN engine_standing_calculations calculation
      ON calculation.id = active.calculation_id
    LEFT JOIN engine_pod_finalizations finalization
      ON finalization.id = pod.active_finalization_id
    WHERE pod.tournament_id = $1::uuid
    ORDER BY pod.sequence, pod.public_key
  `, [tournamentId])).rows;
}

async function readRosters(
  executor: EnginePostgresExecutor,
  tournamentId: string
): Promise<RosterRow[]> {
  return (await executor.query<RosterRow>(`
    SELECT team.public_key AS team_public_key, team.name AS team_name,
           team.sequence AS team_sequence, pod.public_key AS pod_public_key,
           assignment.initial_seed, player.public_key AS player_public_key,
           player.display_name AS player_name, membership.roster_slot
    FROM engine_teams team
    JOIN engine_pod_teams assignment
      ON assignment.tournament_id = team.tournament_id
     AND assignment.team_id = team.id
    JOIN engine_pods pod ON pod.id = assignment.pod_id
    LEFT JOIN engine_roster_memberships membership
      ON membership.tournament_id = team.tournament_id
     AND membership.team_id = team.id AND membership.closed_at IS NULL
    LEFT JOIN engine_players player ON player.id = membership.player_id
    WHERE team.tournament_id = $1::uuid
    ORDER BY team.sequence, membership.roster_slot, player.public_key
  `, [tournamentId])).rows;
}

async function readStandings(
  executor: EnginePostgresExecutor,
  tournamentId: string
): Promise<StandingRow[]> {
  return (await executor.query<StandingRow>(`
    SELECT active.pod_id::text AS pod_id, team.public_key AS team_public_key,
           team.name AS team_name, row.rank, row.wins, row.losses,
           row.cup_differential, row.makes, row.attempts,
           row.shooting_percentage, row.tie_group, row.administrator_resolution
    FROM engine_active_pod_standing_calculations active
    JOIN engine_standing_rows row ON row.calculation_id = active.calculation_id
    JOIN engine_teams team ON team.id = row.team_id
    WHERE active.tournament_id = $1::uuid
    ORDER BY active.pod_id, row.rank NULLS LAST, team.sequence
  `, [tournamentId])).rows;
}

async function readMatches(
  executor: EnginePostgresExecutor,
  tournamentId: string
): Promise<MatchRow[]> {
  return (await executor.query<MatchRow>(`
    SELECT match.id::text, match.public_key, match.stage,
           pod.public_key AS pod_public_key, match.sequence, match.status,
           match.score_availability, match.scheduled_at, match.started_at,
           match.ended_at, match.updated_at, match.row_version,
           revision.revision_number, revision.reason AS revision_reason,
           revision.correction_reason,
           previous.revision_number AS previous_revision_number,
           COALESCE(node.public_key, historic_node.public_key)
             AS bracket_match_public_key,
           COALESCE(instance.instance_number, 1) AS instance_number,
           prior.public_key AS replaces_match_public_key,
           successor.public_key AS replaced_by_match_public_key,
           COALESCE(revision_winner.public_key, winner.public_key)
             AS winner_public_key,
           COALESCE(revision_winner.name, winner.name) AS winner_name
    FROM engine_matches match
    LEFT JOIN engine_pods pod ON pod.id = match.pod_id
    LEFT JOIN engine_match_revisions revision ON revision.id = match.active_revision_id
    LEFT JOIN engine_match_revisions previous ON previous.id = revision.previous_revision_id
    LEFT JOIN engine_match_revision_teams winning_revision_team
      ON winning_revision_team.revision_id = revision.id
     AND winning_revision_team.result = 'win'
    LEFT JOIN engine_teams revision_winner
      ON revision_winner.id = winning_revision_team.team_id
    LEFT JOIN engine_bracket_matches node
      ON node.tournament_id = match.tournament_id AND node.match_id = match.id
    LEFT JOIN LATERAL (
      SELECT replacement.*
      FROM engine_bracket_match_replacements replacement
      WHERE replacement.replacement_match_id = match.id
      ORDER BY replacement.replaced_at DESC, replacement.id DESC LIMIT 1
    ) introduced ON match.stage = 'playoffs'
    LEFT JOIN LATERAL (
      SELECT replacement.*
      FROM engine_bracket_match_replacements replacement
      WHERE replacement.previous_match_id = match.id
      ORDER BY replacement.replaced_at DESC, replacement.id DESC LIMIT 1
    ) superseded ON match.stage = 'playoffs'
    LEFT JOIN engine_bracket_matches historic_node
      ON historic_node.id = COALESCE(
        introduced.bracket_match_id, superseded.bracket_match_id
      )
    LEFT JOIN engine_matches prior
      ON prior.id = introduced.previous_match_id
    LEFT JOIN engine_matches successor
      ON successor.id = superseded.replacement_match_id
    LEFT JOIN LATERAL (
      SELECT count(*)::integer + 1 AS instance_number
      FROM engine_bracket_match_replacements item
      WHERE item.bracket_match_id = COALESCE(node.id, historic_node.id)
        AND item.replaced_at <= COALESCE(introduced.replaced_at, '-infinity')
    ) instance ON match.stage = 'playoffs'
    LEFT JOIN engine_active_bracket_match_resolutions active_resolution
      ON active_resolution.tournament_id = match.tournament_id
     AND active_resolution.bracket_match_id = COALESCE(node.id, historic_node.id)
    LEFT JOIN engine_bracket_match_resolutions resolution
      ON resolution.id = active_resolution.resolution_id
     AND resolution.match_id = match.id
    LEFT JOIN engine_teams winner ON winner.id = resolution.winner_team_id
    WHERE match.tournament_id = $1::uuid AND NOT match.identity_only
    ORDER BY match.stage, match.sequence, match.public_key
  `, [tournamentId])).rows;
}

async function readParticipants(
  executor: EnginePostgresExecutor,
  tournamentId: string
): Promise<ParticipantRow[]> {
  return (await executor.query<ParticipantRow>(`
    WITH match_teams AS (
      SELECT match.id AS match_id, revision_team.side_number,
             revision_team.team_id, revision_team.score,
             revision_team.result, match.active_revision_id AS revision_id
      FROM engine_matches match
      JOIN engine_match_revision_teams revision_team
        ON revision_team.revision_id = match.active_revision_id
      WHERE match.tournament_id = $1::uuid AND NOT match.identity_only
      UNION ALL
      SELECT match.id, slot.slot_number, slot.team_id, NULL::integer,
             'pending'::text, NULL::uuid
      FROM engine_matches match
      JOIN engine_match_slots slot ON slot.match_id = match.id
      WHERE match.tournament_id = $1::uuid AND NOT match.identity_only
        AND match.active_revision_id IS NULL AND slot.team_id IS NOT NULL
    )
    SELECT source.match_id::text, source.side_number,
           team.public_key AS team_public_key, team.name AS team_name,
           source.score, source.result,
           COALESCE(match_slot.seed, bracket_slot.seed) AS seed,
           player.public_key AS player_public_key,
           COALESCE(revision_player.display_name_at_revision, player.display_name)
             AS player_name,
           COALESCE(revision_player.roster_slot, membership.roster_slot)
             AS roster_slot
    FROM match_teams source
    JOIN engine_teams team ON team.id = source.team_id
    LEFT JOIN engine_match_revision_players revision_player
      ON revision_player.revision_id = source.revision_id
     AND revision_player.side_number = source.side_number
     AND revision_player.team_id = source.team_id
    LEFT JOIN engine_roster_memberships membership
      ON source.revision_id IS NULL AND membership.tournament_id = $1::uuid
     AND membership.team_id = source.team_id AND membership.closed_at IS NULL
    LEFT JOIN engine_players player ON player.id = COALESCE(
      revision_player.player_id, membership.player_id
    )
    LEFT JOIN engine_match_slots match_slot
      ON match_slot.match_id = source.match_id
     AND match_slot.slot_number = source.side_number
    LEFT JOIN engine_bracket_matches node ON node.match_id = source.match_id
    LEFT JOIN engine_bracket_slots bracket_slot
      ON bracket_slot.bracket_match_id = node.id
     AND bracket_slot.slot_number = source.side_number
    ORDER BY source.match_id, source.side_number,
             COALESCE(revision_player.roster_slot, membership.roster_slot),
             player.public_key
  `, [tournamentId])).rows;
}

async function readEvents(
  executor: EnginePostgresExecutor,
  tournamentId: string
): Promise<EventRow[]> {
  return (await executor.query<EventRow>(`
    SELECT match.id::text AS match_id,
           match.public_key || ':event:' || event.sequence AS event_public_key,
           event.sequence, event.event_type,
           team.public_key AS team_public_key,
           player.public_key AS player_public_key,
           revision_player.display_name_at_revision AS player_name,
           revision_player.side_number, event.occurred_at,
           attempt.outcome, attempt.cup_delta, attempt.phase,
           attempt.turn_number, attempt.team_turn_order,
           attempt.shot_in_team_turn, classification.classification
    FROM engine_matches match
    JOIN engine_match_events event ON event.revision_id = match.active_revision_id
    LEFT JOIN engine_teams team ON team.id = event.team_id
    LEFT JOIN engine_players player ON player.id = event.player_id
    LEFT JOIN engine_match_revision_players revision_player
      ON revision_player.revision_id = match.active_revision_id
     AND revision_player.player_id = event.player_id
    LEFT JOIN engine_shot_attempts attempt ON attempt.event_id = event.id
    LEFT JOIN engine_shot_classifications classification
      ON classification.event_id = event.id
    WHERE match.tournament_id = $1::uuid AND NOT match.identity_only
    ORDER BY match.sequence, event.sequence, event.id
  `, [tournamentId])).rows;
}

async function readStatistics(
  executor: EnginePostgresExecutor,
  tournamentId: string
): Promise<StatisticRow[]> {
  return (await executor.query<StatisticRow>(`
    WITH active_rules AS (
      SELECT active.statistic_run_id, active.rules_version
      FROM engine_active_tournament_statistic_runs active
      WHERE active.tournament_id = $1::uuid
    ), selected_runs AS (
      SELECT active.statistic_run_id
      FROM active_rules active
      UNION
      SELECT scope.statistic_run_id
      FROM engine_canonical_statistic_run_scopes scope
      JOIN active_rules active ON active.rules_version = scope.rules_version
      JOIN engine_matches match
        ON match.tournament_id = scope.tournament_id
       AND match.id = scope.match_id
       AND match.active_revision_id = scope.revision_id
      WHERE scope.tournament_id = $1::uuid
        AND scope.run_kind = 'match_revision'
        AND NOT match.identity_only
    )
    SELECT value.scope,
           CASE value.scope WHEN 'match' THEN match.public_key
             WHEN 'pod' THEN pod.public_key ELSE tournament.public_key END
             AS scope_public_key,
           value.stage, value.subject_type,
           COALESCE(team.public_key, player.public_key) AS subject_public_key,
           COALESCE(team.name, player.display_name) AS subject_name,
           value.metric, value.value
    FROM selected_runs selected
    JOIN engine_canonical_statistic_values value
      ON value.statistic_run_id = selected.statistic_run_id
    JOIN engine_tournaments tournament ON tournament.id = value.tournament_id
    LEFT JOIN engine_matches match ON match.id = value.match_id
    LEFT JOIN engine_pods pod ON pod.id = value.pod_id
    LEFT JOIN engine_teams team
      ON value.subject_type = 'team' AND team.id = value.subject_id
    LEFT JOIN engine_players player
      ON value.subject_type = 'player' AND player.id = value.subject_id
    WHERE value.tournament_id = $1::uuid
    ORDER BY value.scope, scope_public_key, value.stage,
             value.subject_type, subject_public_key, value.metric
  `, [tournamentId])).rows;
}

async function readSeeds(
  executor: EnginePostgresExecutor,
  tournamentId: string
): Promise<SeedRow[]> {
  return (await executor.query<SeedRow>(`
    SELECT team.public_key AS team_public_key, team.name AS team_name,
           effective.calculated_seed, effective.effective_seed,
           effective.override_id::text
    FROM engine_active_seed_calculations active
    JOIN engine_effective_seeds effective
      ON effective.tournament_id = active.tournament_id
    JOIN engine_teams team ON team.id = effective.team_id
    WHERE active.tournament_id = $1::uuid
    ORDER BY effective.effective_seed, team.public_key
  `, [tournamentId])).rows;
}

async function readBracket(
  executor: EnginePostgresExecutor,
  tournamentId: string
): Promise<BracketRow[]> {
  return (await executor.query<BracketRow>(`
    SELECT bracket.public_key AS bracket_public_key,
           bracket.name AS bracket_name, bracket.bracket_size,
           round.public_key AS round_public_key, round.name AS round_name,
           round.sequence AS round_sequence,
           node.public_key AS bracket_match_public_key,
           node.sequence AS bracket_match_sequence,
           match.public_key AS match_public_key, match.status AS match_status,
           slot.slot_number, slot.source_type,
           team.public_key AS team_public_key, team.name AS team_name,
           source_node.public_key AS source_bracket_match_public_key,
           slot.seed, winner.public_key AS winner_public_key,
           winner.name AS winner_name, resolution.resolution_type,
           (SELECT count(*)::integer
            FROM engine_bracket_match_replacements replacement
            WHERE replacement.bracket_match_id = node.id) AS replacement_count,
           replaced.public_key AS replaced_match_public_key
    FROM engine_active_brackets active
    JOIN engine_brackets bracket ON bracket.id = active.bracket_id
    JOIN engine_bracket_rounds round ON round.bracket_id = bracket.id
    JOIN engine_bracket_matches node ON node.round_id = round.id
    JOIN engine_bracket_slots slot ON slot.bracket_match_id = node.id
    LEFT JOIN engine_matches match ON match.id = node.match_id
    LEFT JOIN engine_teams team ON team.id = slot.team_id
    LEFT JOIN engine_bracket_matches source_node
      ON source_node.id = slot.source_bracket_match_id
    LEFT JOIN engine_active_bracket_match_resolutions active_resolution
      ON active_resolution.tournament_id = node.tournament_id
     AND active_resolution.bracket_match_id = node.id
    LEFT JOIN engine_bracket_match_resolutions resolution
      ON resolution.id = active_resolution.resolution_id
    LEFT JOIN engine_teams winner ON winner.id = resolution.winner_team_id
    LEFT JOIN LATERAL (
      SELECT prior.public_key
      FROM engine_bracket_match_replacements replacement
      JOIN engine_matches prior ON prior.id = replacement.previous_match_id
      WHERE replacement.bracket_match_id = node.id
      ORDER BY replacement.replaced_at DESC, replacement.id DESC LIMIT 1
    ) replaced ON true
    WHERE active.tournament_id = $1::uuid
    ORDER BY round.sequence, node.sequence, slot.slot_number
  `, [tournamentId])).rows;
}

async function readPointers(
  executor: EnginePostgresExecutor,
  tournamentId: string
): Promise<Record<string, string>> {
  const rows = (await executor.query<{
    pointer_kind: string;
    pointer_value: string;
  }>(`
    SELECT 'statisticRun' AS pointer_kind, statistic_run_id::text AS pointer_value
    FROM engine_active_tournament_statistic_runs WHERE tournament_id = $1::uuid
    UNION ALL SELECT 'podStanding:' || pod_id::text, calculation_id::text
    FROM engine_active_pod_standing_calculations WHERE tournament_id = $1::uuid
    UNION ALL SELECT 'tournamentStanding', calculation_id::text
    FROM engine_active_tournament_standing_calculations WHERE tournament_id = $1::uuid
    UNION ALL SELECT 'seedReview', review_version_id::text
    FROM engine_active_global_seed_reviews WHERE tournament_id = $1::uuid
    UNION ALL SELECT 'seedCalculation', calculation_id::text
    FROM engine_active_seed_calculations WHERE tournament_id = $1::uuid
    UNION ALL SELECT 'seedOverride', command_id::text
    FROM engine_active_seed_override_commands WHERE tournament_id = $1::uuid
    UNION ALL SELECT 'bracket', bracket_id::text
    FROM engine_active_brackets WHERE tournament_id = $1::uuid
    UNION ALL SELECT 'bracketResolution:' || bracket_match_id::text,
      resolution_id::text FROM engine_active_bracket_match_resolutions
      WHERE tournament_id = $1::uuid
    UNION ALL SELECT 'matchRevision:' || id::text, active_revision_id::text
    FROM engine_matches WHERE tournament_id = $1::uuid
      AND active_revision_id IS NOT NULL
    ORDER BY pointer_kind
  `, [tournamentId])).rows;
  return Object.fromEntries(rows.map((row) => [row.pointer_kind, row.pointer_value]));
}

function toTournamentSummary(row: TournamentRow): CanonicalPublicTournamentSummary {
  return {
    id: row.public_key,
    gameType: row.game_type,
    year: row.year,
    name: row.name,
    lifecycle: row.lifecycle
  };
}

function buildRosters(rows: readonly RosterRow[]): CanonicalPublicRosterTeam[] {
  const teams: CanonicalPublicRosterTeam[] = [];
  for (const row of rows) {
    let team = teams.find((item) => item.id === row.team_public_key);
    if (team === undefined) {
      team = {
        id: row.team_public_key,
        name: row.team_name,
        podId: row.pod_public_key,
        initialPodSeed: row.initial_seed,
        players: []
      };
      teams.push(team);
    }
    if (
      row.player_public_key !== null && row.player_name !== null &&
      row.roster_slot !== null
    ) {
      (team.players as CanonicalPublicRosterTeam["players"][number][]).push({
        id: row.player_public_key,
        displayName: row.player_name,
        rosterSlot: row.roster_slot
      });
    }
  }
  return teams;
}

function buildPods(
  pods: readonly PodRow[],
  standings: readonly StandingRow[]
): CanonicalPublicPod[] {
  return pods.map((pod) => {
    const rows = standings.filter((row) => row.pod_id === pod.id).map((row) => ({
      team: { id: row.team_public_key, name: row.team_name },
      rank: row.rank,
      wins: row.wins,
      losses: row.losses,
      cupDifferential: row.cup_differential,
      makes: row.makes ?? 0,
      attempts: row.attempts ?? 0,
      shootingPercentage: numeric(row.shooting_percentage),
      tieGroup: row.tie_group,
      administratorResolved: row.administrator_resolution !== null
    }));
    const standingState = pod.active_finalization_id !== null
      ? "finalized"
      : pod.calculation_status === "unresolved_tie"
        ? "unresolved_tie"
        : rows.length === 0 ? "zero_game" : "active";
    return {
      id: pod.public_key,
      name: pod.name,
      sequence: pod.sequence,
      standingState,
      finalizedAt: iso(pod.finalized_at),
      standings: rows
    };
  });
}

function toSeed(row: SeedRow): CanonicalPublicSeed {
  return {
    team: { id: row.team_public_key, name: row.team_name },
    calculatedSeed: row.calculated_seed,
    effectiveSeed: row.effective_seed,
    overridden: row.override_id !== null
  };
}

function buildStatistics(rows: readonly StatisticRow[]): CanonicalPublicStatistic[] {
  const statistics: CanonicalPublicStatistic[] = [];
  for (const row of rows) {
    const stage = row.stage === "pod"
      ? "pod_play"
      : row.stage === "playoff" ? "playoffs" : null;
    let statistic = statistics.find((item) =>
      item.scope === row.scope && item.scopeId === row.scope_public_key &&
      item.stage === stage && item.subject?.id === row.subject_public_key
    );
    if (statistic === undefined) {
      statistic = {
        scope: row.scope,
        scopeId: row.scope_public_key,
        stage,
        subject: row.subject_type === "team"
          ? { id: row.subject_public_key, name: row.subject_name }
          : { id: row.subject_public_key, displayName: row.subject_name },
        values: {}
      };
      statistics.push(statistic);
    }
    (statistic.values as Record<string, number | null>)[row.metric] = numeric(row.value);
  }
  return statistics;
}

function buildMatch(
  row: MatchRow,
  participantRows: readonly ParticipantRow[],
  eventRows: readonly EventRow[],
  statistics: readonly CanonicalPublicStatistic[]
): CanonicalPublicMatch {
  const participants: CanonicalPublicMatchParticipant[] = [];
  for (const source of participantRows) {
    let participant = participants.find((item) => item.side === source.side_number);
    if (participant === undefined) {
      participant = {
        side: source.side_number,
        role: source.side_number === 1 ? "home" : "away",
        team: { id: source.team_public_key, name: source.team_name },
        players: [],
        seed: source.seed,
        score: source.score,
        result: source.result === "pending" ? null : source.result
      };
      participants.push(participant);
    }
    if (
      source.player_public_key !== null && source.player_name !== null &&
      source.roster_slot !== null
    ) {
      (participant.players as CanonicalPublicMatchParticipant["players"][number][]).push({
        id: source.player_public_key,
        displayName: source.player_name,
        rosterSlot: source.roster_slot
      });
    }
  }
  const available = row.score_availability === "partial" ||
    row.score_availability === "complete";
  return {
    id: row.public_key,
    sequence: row.sequence,
    stage: row.stage,
    podId: row.pod_public_key,
    bracketMatchId: row.bracket_match_public_key,
    instance: row.instance_number,
    revision: row.revision_number,
    status: row.status,
    scoreAvailability: row.score_availability,
    correction: {
      isCorrection: row.revision_reason === "correction" ||
        row.replaces_match_public_key !== null ||
        row.replaced_by_match_public_key !== null,
      reason: row.correction_reason,
      previousRevision: row.previous_revision_number,
      replacesMatchId: row.replaces_match_public_key,
      replacedByMatchId: row.replaced_by_match_public_key
    },
    timestamps: {
      scheduledAt: iso(row.scheduled_at),
      startedAt: iso(row.started_at),
      endedAt: iso(row.ended_at),
      updatedAt: iso(row.updated_at) as string
    },
    participants,
    winner: row.winner_public_key === null || row.winner_name === null
      ? participants.find((item) => item.result === "win")?.team ?? null
      : { id: row.winner_public_key, name: row.winner_name },
    events: eventRows.map(toEvent),
    statistics,
    boxScore: available ? buildBoxScore(statistics, participants) : null,
    scorecard: available ? buildScorecard(eventRows) : null
  };
}

function toEvent(row: EventRow): CanonicalPublicMatchEvent {
  return {
    id: row.event_public_key,
    sequence: row.sequence,
    type: row.event_type,
    teamId: row.team_public_key,
    playerId: row.player_public_key,
    occurredAt: iso(row.occurred_at),
    details: {
      ...(row.outcome === null ? {} : { outcome: row.outcome }),
      ...(row.cup_delta === null ? {} : { cupDelta: row.cup_delta }),
      ...(row.phase === null ? {} : { phase: row.phase }),
      ...(row.turn_number === null ? {} : { turnNumber: row.turn_number }),
      ...(row.team_turn_order === null ? {} : { teamTurnOrder: row.team_turn_order }),
      ...(row.shot_in_team_turn === null ? {} : { shotInTeamTurn: row.shot_in_team_turn }),
      ...(row.classification === null ? {} : { classification: row.classification })
    }
  };
}

function buildBoxScore(
  statistics: readonly CanonicalPublicStatistic[],
  participants: readonly CanonicalPublicMatchParticipant[]
): CanonicalPublicBoxScore {
  const keys = [...new Set(statistics.flatMap((item) => Object.keys(item.values)))].sort();
  return {
    columns: keys.map((key) => ({
      key,
      label: label(key),
      format: key === "shooting_percentage" ? "percentage" : "integer"
    })),
    rows: statistics.flatMap((item, index) => {
      if (item.subject === null) {
        return [];
      }
      const teamId = "name" in item.subject
        ? item.subject.id
        : participants.find((participant) =>
          participant.players.some((player) => player.id === item.subject?.id)
        )?.team.id ?? "";
      return [{
        id: `box-score-${index + 1}-${item.subject.id}`,
        subject: "name" in item.subject
          ? { id: item.subject.id, displayName: item.subject.name, type: "team" as const }
          : { ...item.subject, type: "player" as const },
        teamId,
        values: item.values
      }];
    }),
    totals: {}
  };
}

function buildScorecard(rows: readonly EventRow[]): CanonicalPublicScorecard {
  return {
    columns: [
      { key: "sequence", label: "Play", kind: "sequence" },
      { key: "player", label: "Player", kind: "participant" },
      { key: "outcome", label: "Result", kind: "value" },
      { key: "classification", label: "Type", kind: "marker" },
      { key: "cupDelta", label: "Cups", kind: "value" }
    ],
    rows: rows.filter((row) => row.event_type === "shot_attempt").map((row) => ({
      id: row.event_public_key,
      sequence: row.sequence,
      side: row.side_number ?? 1,
      teamId: row.team_public_key ?? "",
      playerId: row.player_public_key,
      playerDisplayName: row.player_name,
      values: {
        sequence: row.sequence,
        player: row.player_name,
        outcome: row.outcome,
        classification: row.classification,
        cupDelta: row.cup_delta
      }
    }))
  };
}

function buildBracket(rows: readonly BracketRow[]): CanonicalPublicBracket | null {
  const first = rows[0];
  if (first === undefined) {
    return null;
  }
  const rounds: Array<CanonicalPublicBracket["rounds"][number]> = [];
  for (const row of rows) {
    let round = rounds.find((item) => item.id === row.round_public_key);
    if (round === undefined) {
      round = {
        id: row.round_public_key,
        name: row.round_name,
        sequence: row.round_sequence,
        matches: []
      };
      rounds.push(round);
    }
    let match = round.matches.find((item) => item.id === row.bracket_match_public_key);
    if (match === undefined) {
      match = {
        id: row.bracket_match_public_key,
        round: row.round_sequence,
        position: row.bracket_match_sequence,
        status: bracketStatus(row),
        matchId: row.match_public_key,
        replacedMatchId: row.replaced_match_public_key,
        slots: [] as unknown as CanonicalPublicBracketMatch["slots"],
        winner: row.winner_public_key === null || row.winner_name === null
          ? null
          : { id: row.winner_public_key, name: row.winner_name }
      };
      (round.matches as CanonicalPublicBracketMatch[]).push(match);
    }
    (match.slots as unknown as CanonicalPublicBracketSlot[]).push(toSlot(row));
  }
  return {
    id: first.bracket_public_key,
    name: first.bracket_name,
    size: first.bracket_size,
    rounds
  };
}

function bracketStatus(row: BracketRow): CanonicalPublicBracketMatch["status"] {
  if (row.resolution_type === "structural_bye") return "bye";
  if (row.winner_public_key !== null) return "completed";
  if (row.replacement_count > 0) return "corrected";
  if (row.match_status === "in_progress") return "in_progress";
  return "pending";
}

function toSlot(row: BracketRow): CanonicalPublicBracketSlot {
  if (row.source_type === "team") {
    if (row.team_public_key === null || row.team_name === null) {
      throw new EnginePersistenceInvariantError("Bracket team slot has no team.");
    }
    return {
      source: "team",
      team: { id: row.team_public_key, name: row.team_name },
      seed: row.seed
    };
  }
  if (row.source_type === "match_winner") {
    if (row.source_bracket_match_public_key === null) {
      throw new EnginePersistenceInvariantError(
        "Bracket winner slot has no source bracket match."
      );
    }
    return {
      source: "match_winner",
      sourceBracketMatchId: row.source_bracket_match_public_key,
      team: row.team_public_key === null || row.team_name === null
        ? null
        : { id: row.team_public_key, name: row.team_name },
      seed: row.seed
    };
  }
  return row.source_type === "bye"
    ? { source: "bye", team: null, seed: null }
    : { source: "tbd", team: null, seed: null };
}

export function toCanonicalMatchSummary(
  match: CanonicalPublicMatch
): CanonicalPublicMatchSummary {
  const { events: _events, statistics: _statistics, boxScore: _boxScore,
    scorecard: _scorecard, ...summary } = match;
  return summary;
}

function validateSource(
  tournament: CanonicalPublicTournament,
  matches: readonly CanonicalPublicProjectionMatchSource[]
): void {
  const ids = new Set<string>();
  for (const item of matches) {
    if (ids.has(item.detail.id) || item.detail.participants.length !== 2) {
      throw new EnginePersistenceInvariantError(
        "Canonical public matches require unique identities and two participants."
      );
    }
    ids.add(item.detail.id);
    if (
      !["partial", "complete"].includes(item.detail.scoreAvailability) &&
      item.detail.participants.some((participant) => participant.score !== null)
    ) {
      throw new EnginePersistenceInvariantError(
        `Public match '${item.detail.id}' cannot expose an unavailable score.`
      );
    }
  }
  if (tournament.matches.length !== matches.length) {
    throw new EnginePersistenceInvariantError(
      "Tournament and match projection counts must agree."
    );
  }
  for (const round of tournament.bracket?.rounds ?? []) {
    for (const match of round.matches) {
      if (match.slots.length !== 2) {
        throw new EnginePersistenceInvariantError(
          "Every public bracket match requires exactly two slots."
        );
      }
    }
  }
}

function numeric(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new EnginePersistenceInvariantError("Canonical statistic value is invalid.");
  }
  return parsed;
}

function iso(value: string | Date | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    throw new EnginePersistenceInvariantError("Canonical timestamp is invalid.");
  }
  return date.toISOString();
}

function label(key: string): string {
  return key.split("_").map((word) =>
    `${word.charAt(0).toUpperCase()}${word.slice(1)}`
  ).join(" ");
}
