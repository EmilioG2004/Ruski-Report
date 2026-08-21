import { QueryResult, QueryResultRow } from "pg";

import { LegacySnapshotReader } from "./legacy-backfill.repository";
import {
  LegacyBracketSource,
  LegacyMatchEventSource,
  LegacyMatchParticipantSource,
  LegacyMatchScoreSource,
  LegacyMatchStatisticSource,
  LegacyMatchStatus,
  LegacyScorecardRowSource,
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
  statistics: unknown | null;
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
  box_score: unknown;
  scorecard: unknown;
  events: unknown;
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
  constructor(private readonly database: LegacySnapshotExecutor) {}

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
               snapshot.statistics,
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
                participants, score, metadata, box_score, scorecard, events,
                updated_at
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
    const tournamentStatistics = readTournamentStatistics(header.statistics);
    const matches = matchResult.rows.map(readMatch);
    const currentPlayers = playerResult.rows.map((row) => ({
      legacyPlayerId: row.player_id,
      displayName: row.display_name
    }));
    const players = includeHistoricalPlayers({
      currentPlayers,
      matches,
      tournamentStatistics,
      matchRows: matchResult.rows
    });

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
      tournamentStatistics,
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
      players,
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
      matches,
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

function readMatch(row: MatchRow): LegacyTournamentSource["matches"][number] {
  const participants = readParticipants(row.participants);
  const scorecardRows = readScorecardRows(row.scorecard);
  return {
    legacyMatchId: row.match_id,
    sequence: row.sequence,
    status: readMatchStatus(row.status),
    legacyPodId: row.pod_id ?? undefined,
    legacyBracketMatchId: row.bracket_match_id ?? undefined,
    participants,
    score: readScore(row.score),
    events: readEvents(row.events, participants, scorecardRows),
    statistics: readStatistics(row.box_score),
    scorecardRows,
    detailAvailability: readDetailAvailability(row.metadata),
    updatedAt: toISOString(row.updated_at)
  };
}

function includeHistoricalPlayers(input: {
  currentPlayers: LegacyTournamentSource["players"];
  matches: LegacyTournamentSource["matches"];
  tournamentStatistics: LegacyTournamentSource["tournamentStatistics"];
  matchRows: readonly MatchRow[];
}): LegacyTournamentSource["players"] {
  const referencedIds = new Set<string>();
  for (const match of input.matches) {
    for (const participant of match.participants) {
      participant.legacyPlayerIds.forEach((playerId) =>
        addReferencedPlayer(referencedIds, playerId)
      );
    }
    match.events.forEach((event) =>
      addReferencedPlayer(referencedIds, event.legacyPlayerId)
    );
    match.statistics.forEach((statistic) => {
      if (statistic.legacyPlayerId !== undefined) {
        addReferencedPlayer(referencedIds, statistic.legacyPlayerId);
      }
    });
    match.scorecardRows.forEach((row) => {
      if (row.legacyPlayerId !== undefined) {
        addReferencedPlayer(referencedIds, row.legacyPlayerId);
      }
    });
  }
  for (const table of input.tournamentStatistics) {
    for (const row of table.rows) {
      if (row.legacyPlayerId !== undefined) {
        addReferencedPlayer(referencedIds, row.legacyPlayerId);
      }
    }
  }

  const currentIds = new Set(
    input.currentPlayers.map((player) => player.legacyPlayerId)
  );
  const labelEvidence = readHistoricalPlayerLabelEvidence(
    input.matchRows,
    input.matches
  );
  const historicalPlayers = [...referencedIds]
    .filter((playerId) => !currentIds.has(playerId))
    .sort()
    .map((playerId) => {
      const labels = labelEvidence.boxScore.get(playerId) ??
        labelEvidence.scorecard.get(playerId) ??
        new Set<string>();
      if (labels.size === 0) {
        throw new Error(
          "Legacy historical player lacks an exact public display label."
        );
      }
      if (labels.size !== 1) {
        throw new Error(
          "Legacy historical player has conflicting public display labels."
        );
      }
      return {
        legacyPlayerId: playerId,
        displayName: [...labels][0] as string
      };
    });

  return [...input.currentPlayers, ...historicalPlayers].sort((left, right) =>
    left.legacyPlayerId.localeCompare(right.legacyPlayerId)
  );
}

function addReferencedPlayer(players: Set<string>, playerId: string): void {
  if (playerId.trim().length === 0) {
    throw new Error("Legacy historical player identity is invalid.");
  }
  players.add(playerId);
}

function readHistoricalPlayerLabelEvidence(
  rows: readonly MatchRow[],
  matches: LegacyTournamentSource["matches"]
): {
  boxScore: Map<string, Set<string>>;
  scorecard: Map<string, Set<string>>;
} {
  const boxScore = new Map<string, Set<string>>();
  const scorecard = new Map<string, Set<string>>();
  for (const row of rows) {
    const boxScoreObject = readObject(row.box_score, "match box score");
    const boxScoreRows = boxScoreObject.rows === undefined
      ? []
      : readArray(boxScoreObject.rows, "match box score rows");
    for (const item of boxScoreRows) {
      const subject = readObject(
        readObject(item, "match box score row").subject,
        "match box score subject"
      );
      if (subject.type !== "player") {
        continue;
      }
      const playerId = readOptionalString(subject, "playerId");
      if (playerId !== undefined) {
        addExactLabel(boxScore, playerId, subject.label);
      }
    }
  }
  for (const match of matches) {
    for (const row of match.scorecardRows) {
      if (row.legacyPlayerId !== undefined) {
        addExactLabel(scorecard, row.legacyPlayerId, row.values.shooter);
      }
    }
  }
  return { boxScore, scorecard };
}

function addExactLabel(
  evidence: Map<string, Set<string>>,
  playerId: string,
  value: unknown
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    return;
  }
  const labels = evidence.get(playerId) ?? new Set<string>();
  labels.add(value);
  evidence.set(playerId, labels);
}

interface LegacySnapshotExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<Row>>;
}

function readEvents(
  value: unknown,
  participants: readonly LegacyMatchParticipantSource[],
  scorecardRows: readonly LegacyScorecardRowSource[]
): LegacyMatchEventSource[] {
  return readArray(value, "match events").map((item) => {
    const event = readObject(item, "match event");
    const metadata = readOptionalObject(event.metadata, "match event metadata") ?? {};
    const type = readLegacyEventType(event.type);
    const legacyTeamId = readString(event, "teamId");
    const legacyEventId = readString(event, "id");
    const attribution = resolveLegacyEventPlayer({
      legacyEventId,
      type,
      shooterName: readOptionalString(metadata, "shooterName"),
      sourcePlayerId: readOptionalString(event, "playerId"),
      legacyTeamId,
      participants,
      scorecardRows
    });
    return {
      legacyEventId,
      sequence: readInteger(event, "sequence"),
      type,
      legacyTeamId,
      legacyPlayerId: attribution.playerId,
      legacyScorecardRowId: attribution.scorecardRowId,
      attributionMethod: attribution.method,
      occurredAt: readOptionalTimestamp(event, "occurredAt"),
      phase: readOptionalString(event, "phaseId"),
      turnNumber: readOptionalInteger(metadata, "turnNumber"),
      teamTurnOrder: readOptionalInteger(metadata, "teamTurnOrder"),
      shotInTeamTurn: readOptionalInteger(metadata, "shotInTeamTurn")
    };
  });
}

export function resolveLegacyEventPlayer(input: {
  legacyEventId: string;
  type: LegacyMatchEventSource["type"];
  shooterName?: string;
  sourcePlayerId?: string;
  legacyTeamId: string;
  participants: readonly LegacyMatchParticipantSource[];
  scorecardRows: readonly LegacyScorecardRowSource[];
}): {
  playerId: string;
  scorecardRowId?: string;
  method: LegacyMatchEventSource["attributionMethod"];
} {
  const participant = input.participants.find((candidate) =>
    candidate.legacyTeamId === input.legacyTeamId
  );
  if (participant === undefined) {
    throw new Error("Legacy event team is outside the frozen participants.");
  }
  const scorecardRow = input.scorecardRows.find((row) =>
    row.legacyEventIds.includes(input.legacyEventId)
  );
  if (scorecardRow !== undefined) {
    validateScorecardEvidence(input, scorecardRow);
  }
  if (input.sourcePlayerId !== undefined) {
    requireFrozenPlayer(participant, input.sourcePlayerId);
    if (
      scorecardRow?.legacyPlayerId !== undefined &&
      scorecardRow.legacyPlayerId !== input.sourcePlayerId
    ) {
      throw new Error("Legacy event and scorecard player identities differ.");
    }
    return {
      playerId: input.sourcePlayerId,
      scorecardRowId: scorecardRow?.legacyScorecardRowId,
      method: "source_event_player_id"
    };
  }
  if (scorecardRow === undefined) {
    throw new Error("Legacy missing-player event lacks scorecard evidence.");
  }
  if (scorecardRow.legacyPlayerId !== undefined) {
    requireFrozenPlayer(participant, scorecardRow.legacyPlayerId);
    return {
      playerId: scorecardRow.legacyPlayerId,
      scorecardRowId: scorecardRow.legacyScorecardRowId,
      method: "scorecard_player_id"
    };
  }
  const alias = normalizeAlias(input.shooterName ?? "");
  const exception = legacy2026PlayerAliasExceptions.get(
    `${input.legacyTeamId}|${alias}`
  );
  if (exception !== undefined) {
    requireFrozenPlayer(participant, exception);
    return {
      playerId: exception,
      scorecardRowId: scorecardRow.legacyScorecardRowId,
      method: "legacy_2026_explicit_alias"
    };
  }
  const candidates = participant.legacyPlayerIds.filter((playerId) =>
    stablePlayerKeyAliases(playerId).has(alias)
  );
  if (candidates.length !== 1) {
    throw new Error("Legacy event player alias is ambiguous or unresolved.");
  }
  return {
    playerId: candidates[0] as string,
    scorecardRowId: scorecardRow.legacyScorecardRowId,
    method: "stable_participant_key_alias"
  };
}

function normalizeAlias(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function stablePlayerKeyAliases(playerId: string): Set<string> {
  const tokens = playerId.replace(/^player-/, "").split("-").filter(Boolean);
  const aliases = new Set<string>();
  for (let start = 0; start < tokens.length; start += 1) {
    for (let end = start + 1; end <= tokens.length; end += 1) {
      aliases.add(tokens.slice(start, end).join(" "));
    }
  }
  return aliases;
}

const legacy2026PlayerAliasExceptions = new Map<string, string>([
  ["team-wigs-boggs|wiggs", "player-jack-wigmore"]
]);

function requireFrozenPlayer(
  participant: LegacyMatchParticipantSource,
  playerId: string
): void {
  if (!participant.legacyPlayerIds.includes(playerId)) {
    throw new Error("Legacy event player is outside the frozen participant team.");
  }
}

function validateScorecardEvidence(
  input: Parameters<typeof resolveLegacyEventPlayer>[0],
  row: LegacyScorecardRowSource
): void {
  const shooter = row.values.shooter;
  if (
    row.legacyTeamId !== input.legacyTeamId ||
    typeof shooter !== "string" || shooter !== input.shooterName ||
    row.values[scorecardEventKey(input.type)] !== true
  ) {
    throw new Error("Legacy event and scorecard chronology differ.");
  }
}

function scorecardEventKey(type: LegacyMatchEventSource["type"]): string {
  return type === "splash-out" ? "splashOut" : type;
}

function readStatistics(value: unknown): LegacyMatchStatisticSource[] {
  const boxScore = readObject(value, "match box score");
  const rows = boxScore.rows === undefined
    ? []
    : readArray(boxScore.rows, "match box score rows");
  return rows.flatMap((item) => {
    const row = readObject(item, "match box score row");
    const subject = readObject(row.subject, "match box score subject");
    const subjectType = subject.type;
    if (subjectType !== "team" && subjectType !== "player") {
      return [];
    }
    return [{
      subjectType,
      legacyTeamId: readOptionalString(subject, "teamId"),
      legacyPlayerId: readOptionalString(subject, "playerId"),
      metricValues: readMetricValues(row.stats)
    }];
  });
}

function readTournamentStatistics(
  value: unknown | null
): LegacyTournamentSource["tournamentStatistics"] {
  if (value === null || value === undefined) {
    return [];
  }
  return readArray(value, "tournament statistics").map((item) => {
    const table = readObject(item, "tournament statistic table");
    const scope = table.scope;
    const subjectType = table.subjectType;
    if (scope !== "season" && scope !== "playoffs") {
      throw new Error("Legacy tournament statistic scope is unsupported.");
    }
    if (subjectType !== "team" && subjectType !== "player") {
      throw new Error("Legacy tournament statistic subject is unsupported.");
    }
    return {
      legacyTableId: readString(table, "id"),
      scope,
      subjectType,
      rows: readArray(table.rows, "tournament statistic rows").map((rowValue) => {
        const row = readObject(rowValue, "tournament statistic row");
        const subject = readObject(row.subject, "tournament statistic subject");
        return {
          rank: readInteger(row, "rank"),
          legacyTeamId: readOptionalString(subject, "teamId"),
          legacyPlayerId: readOptionalString(subject, "playerId"),
          metricValues: readMetricValues(row.values)
        };
      })
    };
  });
}

function readScorecardRows(value: unknown): LegacyScorecardRowSource[] {
  const scorecard = readObject(value, "match scorecard");
  const rows = scorecard.rows === undefined
    ? []
    : readArray(scorecard.rows, "match scorecard rows");
  return rows.map((item) => {
    const row = readObject(item, "match scorecard row");
    return {
      legacyScorecardRowId: readString(row, "id"),
      sequence: readInteger(row, "sequence"),
      legacyTeamId: readOptionalString(row, "teamId"),
      legacyPlayerId: readOptionalString(row, "playerId"),
      legacyEventIds: readOptionalStringArray(row, "eventIds"),
      values: readScorecardValues(row.values)
    };
  });
}

function readScorecardValues(
  value: unknown
): Record<string, boolean | number | string | null> {
  const values = readObject(value, "scorecard values");
  return Object.entries(values).reduce<
    Record<string, boolean | number | string | null>
  >((result, [key, item]) => {
    if (
      item !== null && typeof item !== "boolean" &&
      typeof item !== "number" && typeof item !== "string"
    ) {
      throw new Error(`Legacy scorecard value '${key}' is unsupported.`);
    }
    result[key] = item;
    return result;
  }, {});
}

function readLegacyEventType(
  value: unknown
): "make" | "miss" | "splash-out" | "guy" | "tri" | "di" | "vom" {
  switch (value) {
  case "make":
  case "miss":
  case "splash-out":
  case "guy":
  case "tri":
  case "di":
  case "vom":
    return value;
  default:
    throw new Error("Legacy match event type is unsupported.");
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

function readOptionalTimestamp(
  value: Record<string, unknown>,
  key: string
): string | undefined {
  const item = readOptionalString(value, key);
  if (item === undefined) {
    return undefined;
  }
  const parsed = new Date(item);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`Legacy field '${key}' is not a timestamp.`);
  }
  return parsed.toISOString();
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
