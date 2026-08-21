import { randomUUID } from "node:crypto";

import { PostgresDatabase } from "../../database";
import { TransactionContext } from "../../repositories/transaction";
import {
  MatchId,
  parseStableUuid,
  PodId,
  TournamentId,
  TournamentTeamId
} from "../domain";
import {
  calculateGlobalQualifierSeeds,
  createCalculatedEffectiveSeedPlan,
  GLOBAL_QUALIFIER_SEEDING_RULES_VERSION,
  GlobalQualifierSeedCalculation,
  GlobalQualifierTieResolution
} from "../seeding";
import {
  calculatePodStandings,
  CalculatePodStandingsInput,
  POD_STANDINGS_RULES_VERSION,
  PodStandingCalculation,
  PodStandingTieResolution
} from "../standings";
import { canonicalSha256 } from "../workbook/canonical-json";
import { createStablePlayoffMatchInstanceId } from "../bracket";
import {
  ActivateMatchRevisionInput,
  MatchRevisionTeamInput
} from "./contracts";
import { TournamentEngineTransactionManager } from "./engine-transaction.manager";
import {
  EnginePersistenceConflictError,
  EnginePersistenceInvariantError,
  EngineWriterLeaseConflictError
} from "./errors";
import {
  engineExecutor,
  EnginePostgresExecutor,
  lockEngineMatch,
  lockEngineTournament,
  writeEngineAuditEvent,
  writeEngineJson
} from "./postgres-engine-executor";
import { PostgresCanonicalStatisticRepository } from "./postgres-canonical-statistic.repository";
import { PostgresMatchRevisionRepository } from "./postgres-match-revision.repository";
import { PostgresMatchWriterRepository } from "./postgres-match-writer.repository";
import {
  ActivateGlobalSeedsInput,
  ActivatePodStandingsInput,
  ActivatePodStandingsResult,
  ActiveSeedResult,
  ApplySeedOverridePermutationInput,
  BracketMatchRecord,
  BracketRoundRecord,
  EffectiveSeedRecord,
  FinalizePodInput,
  FinalizePodResult,
  InvalidatePodFinalizationInput,
  OperatorMatchResolutionPreview,
  PodStandingArtifactInput,
  PreviewOperatorMatchResolutionInput,
  PublishBracketInput,
  PublishBracketResult,
  RecordOperatorMatchResolutionInput,
  RecordOperatorMatchResolutionResult,
  RecordOperatorMatchResolutionWithCascadeInput,
  RecordOperatorMatchResolutionWithCascadeResult,
  RefreshProgressionAfterRevisionInput,
  RefreshProgressionAfterRevisionResult,
  ReplaceStartedDependentsForActiveCorrectionInput,
  ReplaceStartedDependentsForActiveCorrectionResult,
  ReplaceStartedDependentMatchInput,
  ReplaceStartedDependentMatchResult,
  ResolveBracketMatchInput,
  ResolveBracketMatchResult,
  ResolveGlobalSeedTieInput,
  GlobalSeedReviewResult,
  ResolvePodTieInput,
  TournamentProgressionRecord,
  TournamentProgressionRepositoryContract
} from "./progression-contracts";

interface LockedTournamentRow {
  lifecycle: TournamentProgressionRecord["lifecycle"];
  row_version: string | number;
  qualifiers_per_pod: number;
  games_per_pair: number;
  bracket_size: number;
}

function mapPod(
  pod: ProgressionPodRow,
  rows: readonly ProgressionStandingRow[]
): TournamentProgressionRecord["pods"][number] {
  const standingRows = pod.calculation_id === null
    ? []
    : rows.filter((row) => row.calculation_id === pod.calculation_id);
  const tieGroups = new Map<string, ProgressionStandingRow[]>();
  for (const row of standingRows) {
    if (row.tie_group !== null) {
      tieGroups.set(row.tie_group, [...(tieGroups.get(row.tie_group) ?? []), row]);
    }
  }
  return {
    podId: parseStableUuid(pod.id, "pod"),
    publicKey: pod.public_key,
    name: pod.name,
    sequence: pod.sequence,
    ...(pod.calculation_id === null ? {} : {
      activeCalculationId: pod.calculation_id
    }),
    ...(pod.calculation_status === null ? {} : {
      calculationStatus: pod.calculation_status
    }),
    rows: standingRows.map((row) => ({
      teamId: parseStableUuid(row.team_id, "tournament_team"),
      teamName: row.team_name,
      rank: row.rank,
      wins: row.wins,
      losses: row.losses,
      cupDifferential: row.cup_differential,
      makes: row.makes,
      attempts: row.attempts,
      shootingPercentage: row.shooting_percentage === null
        ? null
        : Number(row.shooting_percentage),
      qualified: row.qualified,
      ...(row.tie_group === null ? {} : { tieGroupId: row.tie_group }),
      ...(row.administrator_resolution === null ? {} : {
        administratorResolution: row.administrator_resolution
      })
    })),
    tieGroups: [...tieGroups.entries()].map(([tieGroupId, group]) => ({
      tieGroupId,
      teamIds: group.map((row) =>
        parseStableUuid(row.team_id, "tournament_team")
      ),
      resolved: group.every((row) => row.administrator_resolution !== null)
    })),
    ...(pod.finalization_id === null ? {} : {
      activeFinalizationId: pod.finalization_id,
      finalizedAt: toIso(pod.finalized_at)
    })
  };
}

function readTieGroups(value: unknown): NonNullable<
TournamentProgressionRecord["activeGlobalSeedReview"]
>["tieGroups"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      typeof item !== "object" || item === null ||
      !("tieGroupId" in item) || typeof item.tieGroupId !== "string" ||
      !("teamIds" in item) || !Array.isArray(item.teamIds) ||
      !("resolved" in item) || typeof item.resolved !== "boolean"
    ) return [];
    return [{
      tieGroupId: item.tieGroupId,
      teamIds: item.teamIds.map((teamId: unknown) =>
        parseStableUuid(String(teamId), "tournament_team")
      ),
      resolved: item.resolved
    }];
  });
}

function mapSeed(row: ProgressionSeedRow): EffectiveSeedRecord {
  return {
    teamId: parseStableUuid(row.team_id, "tournament_team"),
    calculatedSeed: row.calculated_seed,
    effectiveSeed: row.effective_seed,
    ...(row.override_id === null ? {} : { overrideId: row.override_id })
  };
}

function mapBracketSlot(row: ProgressionBracketSlotRow) {
  return {
    slotNumber: row.slot_number,
    sourceType: row.source_type,
    ...(row.team_id === null ? {} : {
      teamId: parseStableUuid(row.team_id, "tournament_team")
    }),
    ...(row.team_name === null ? {} : { teamName: row.team_name }),
    ...(row.source_bracket_match_id === null ? {} : {
      sourceBracketMatchId: parseStableUuid(
        row.source_bracket_match_id, "bracket_match"
      )
    }),
    ...(row.seed === null ? {} : { seed: row.seed })
  };
}

function assertPodArtifact(input: ActivatePodStandingsInput): void {
  if (
    input.artifact.source.tournamentId !== input.tournamentId ||
    input.artifact.source.podId !== input.podId
  ) invariant("Pod standing artifact belongs to a different scope.");
  const recomputed = calculatePodStandings(input.artifact.source);
  if (
    canonicalSha256(recomputed) !== canonicalSha256(input.artifact.calculation)
  ) invariant("Pod standing artifact does not match authoritative calculation input.");
  assertExactStrings(
    input.artifact.rows.map((row) => row.teamId),
    input.artifact.calculation.rows.map((row) => row.teamId),
    "Standing row identities must cover every calculated team"
  );
}

function artifactFromCalculation(
  calculationId: string,
  source: CalculatePodStandingsInput,
  calculation: PodStandingCalculation,
  createdAt: string
): PodStandingArtifactInput {
  return {
    calculationId,
    source,
    calculation,
    rows: calculation.rows.map((row) => ({
      rowId: randomUUID(),
      teamId: row.teamId,
      publicKey: `standing-${calculationId}-${row.teamId}`
    })),
    createdAt
  };
}

async function readPodTieResolutions(
  executor: EnginePostgresExecutor,
  calculationId: string
): Promise<readonly PodStandingTieResolution[]> {
  const value = (await executor.query<{ calculation_input: unknown }>(`
    SELECT calculation_input FROM engine_standing_calculations
    WHERE id = $1::uuid
  `, [calculationId])).rows[0]?.calculation_input;
  if (typeof value !== "object" || value === null || !("tieResolutions" in value)) {
    return [];
  }
  return Array.isArray(value.tieResolutions)
    ? value.tieResolutions as unknown as readonly PodStandingTieResolution[]
    : [];
}

async function readGlobalTieResolutions(
  executor: EnginePostgresExecutor,
  tournamentId: TournamentId,
  seedCalculationId: string
): Promise<readonly GlobalQualifierTieResolution[]> {
  const rows = await executor.query<{
    id: string;
    tie_group: string;
    ordered_team_ids: string[];
    reason: string;
    resolved_by_admin_id: string;
    resolved_at: Date | string;
  }>(`
    SELECT id::text, tie_group, ordered_team_ids::text[], reason,
           resolved_by_admin_id::text, resolved_at
    FROM engine_global_seed_resolution_commands
    WHERE tournament_id = $1::uuid AND seed_calculation_id = $2::uuid
    ORDER BY resolved_at, id
  `, [tournamentId, seedCalculationId]);
  return rows.rows.map((row) => ({
    resolutionId: row.id,
    tieGroupId: row.tie_group,
    orderedTeamIds: row.ordered_team_ids.map((teamId) =>
      parseStableUuid(teamId, "tournament_team")
    ),
    reason: row.reason,
    resolvedBy: row.resolved_by_admin_id,
    resolvedAt: toIso(row.resolved_at)
  }));
}

async function readActiveFinalizationIds(
  executor: EnginePostgresExecutor,
  tournamentId: TournamentId
): Promise<readonly string[]> {
  const rows = await executor.query<{ id: string }>(`
    SELECT active_finalization_id::text AS id FROM engine_pods
    WHERE tournament_id = $1::uuid AND active_finalization_id IS NOT NULL
    ORDER BY sequence
  `, [tournamentId]);
  return rows.rows.map((row) => row.id);
}

async function hasActiveBracket(
  executor: EnginePostgresExecutor,
  tournamentId: TournamentId
): Promise<boolean> {
  return (await executor.query(`
    SELECT 1 FROM engine_active_brackets WHERE tournament_id = $1::uuid
  `, [tournamentId])).rows[0] !== undefined;
}

async function updateTournamentVersion(
  executor: EnginePostgresExecutor,
  tournamentId: TournamentId,
  expectedRowVersion: number,
  lifecycle: TournamentProgressionRecord["lifecycle"],
  occurredAt: string
): Promise<number> {
  const updated = await executor.query<{ row_version: string | number }>(`
    UPDATE engine_tournaments
    SET lifecycle = $3, row_version = row_version + 1, updated_at = $4
    WHERE id = $1::uuid AND row_version = $2
    RETURNING row_version
  `, [tournamentId, expectedRowVersion, lifecycle, occurredAt]);
  const rowVersion = updated.rows[0]?.row_version;
  if (rowVersion === undefined) {
    conflict("Tournament changed before progression could activate.");
  }
  return Number(rowVersion);
}

async function safeAudit(
  executor: EnginePostgresExecutor,
  input: {
    tournamentId: TournamentId;
    matchId?: MatchId;
    commandType: string;
    actorId?: string;
    occurredAt: string;
    details: Record<string, unknown>;
  }
): Promise<void> {
  await writeEngineAuditEvent(executor, input.tournamentId, {
    eventId: randomUUID(),
    commandType: input.commandType,
    actor: input.actorId === undefined
      ? { kind: "system" }
      : { kind: "administrator", id: input.actorId },
    occurredAt: input.occurredAt,
    details: input.details
  }, input.matchId);
}

function assertTournamentVersion(
  tournament: LockedTournamentRow,
  expected: number
): void {
  if (Number(tournament.row_version) !== expected) {
    conflict("Tournament changed after progression was prepared.");
  }
}

function requireDigest(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    invariant("Confirmation digest must be a lowercase SHA-256 value.");
  }
  return value;
}

function requirePositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    invariant(`${label} must be a positive integer.`);
  }
}

function assertExactStrings(
  actual: readonly string[],
  expected: readonly string[],
  message: string
): void {
  if (
    actual.length !== new Set(actual).size ||
    expected.length !== new Set(expected).size ||
    [...actual].sort().join("|") !== [...expected].sort().join("|")
  ) invariant(message);
}

function assertSeedPermutation(seeds: readonly number[]): void {
  const expected = Array.from({ length: seeds.length }, (_, index) => index + 1);
  if ([...seeds].sort((a, b) => a - b).some((seed, index) =>
    seed !== expected[index]
  )) invariant("Effective seeds must be a complete contiguous permutation.");
}

function invariant(message: string): never {
  throw new EnginePersistenceInvariantError(message);
}

function conflict(message: string): never {
  throw new EnginePersistenceConflictError(message);
}

function toIso(value: Date | string | null): string {
  if (value === null) invariant("Required progression timestamp is missing.");
  return new Date(value).toISOString();
}

function validateBracketInput(
  input: PublishBracketInput,
  effectiveSeeds: readonly { team_id: string; effective_seed: number }[],
  bracketSize: number
): void {
  const rounds = [...input.bracket.rounds].sort((a, b) => a.sequence - b.sequence);
  if (
    rounds.length !== Math.log2(bracketSize) ||
    rounds.some((round, index) => round.sequence !== index + 1)
  ) invariant("Bracket rounds must be a complete ordered single-elimination topology.");
  const nodes = rounds.flatMap((round) => round.matches);
  if (nodes.length !== bracketSize - 1) {
    invariant("Bracket topology must contain bracketSize minus one nodes.");
  }
  for (const round of rounds) {
    const expectedMatchCount = bracketSize / (2 ** round.sequence);
    const orderedMatches = [...round.matches].sort((left, right) =>
      left.sequence - right.sequence
    );
    if (
      orderedMatches.length !== expectedMatchCount ||
      orderedMatches.some((node, index) => node.sequence !== index + 1)
    ) {
      invariant("Bracket matches must use contiguous sequence values within each round.");
    }
  }
  assertExactStrings(
    nodes.map((node) => node.id), [...new Set(nodes.map((node) => node.id))],
    "Bracket match identities must be unique"
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const roundSequenceByNode = new Map(rounds.flatMap((round) =>
    round.matches.map((node) => [node.id, round.sequence] as const)
  ));
  const winnerSourceConsumers = new Map<string, number>();
  const effectiveByTeam = new Map(
    effectiveSeeds.map((row) => [row.team_id, row.effective_seed])
  );
  const directTeams: string[] = [];
  for (const node of nodes) {
    if (node.slots.length !== 2 || new Set(
      node.slots.map((slot) => slot.slotNumber)
    ).size !== 2) {
      invariant("Every bracket node must contain slots one and two.");
    }
    if (node.playable !== (node.match !== undefined)) {
      invariant("Playable nodes require match instances; structural nodes forbid them.");
    }
    if (node.match !== undefined &&
        canonicalSha256(node.match.slots) !== canonicalSha256(node.slots)) {
      invariant("Playoff match slots must exactly match their bracket node.");
    }
    for (const slot of node.slots) {
      if (slot.sourceType === "team") {
        if (slot.teamId === undefined || slot.seed === undefined ||
            effectiveByTeam.get(slot.teamId) !== slot.seed) {
          invariant("Direct bracket teams must match the active effective seed plan.");
        }
        directTeams.push(slot.teamId);
      } else if (slot.sourceType === "match_winner") {
        const sourceRoundSequence = slot.sourceBracketMatchId === undefined
          ? undefined
          : roundSequenceByNode.get(slot.sourceBracketMatchId);
        const destinationRoundSequence = roundSequenceByNode.get(node.id);
        if (
          slot.sourceBracketMatchId === undefined ||
          !nodeIds.has(slot.sourceBracketMatchId) ||
          sourceRoundSequence === undefined ||
          destinationRoundSequence === undefined ||
          sourceRoundSequence !== destinationRoundSequence - 1
        ) invariant("Winner slots must reference the immediate prior round.");
        winnerSourceConsumers.set(
          slot.sourceBracketMatchId,
          (winnerSourceConsumers.get(slot.sourceBracketMatchId) ?? 0) + 1
        );
      }
    }
    if (!node.playable && !isStructuralByeNode(node)) {
      if (!node.slots.every((slot) =>
        slot.sourceType === "match_winner" || slot.sourceType === "tbd"
      )) invariant("A pending future node must depend only on prior winners or TBD slots.");
    }
  }
  assertExactStrings(
    directTeams, effectiveSeeds.map((row) => row.team_id),
    "Bracket direct slots must place every qualifier exactly once"
  );
  const nonFinalNodes = rounds.slice(0, -1).flatMap((round) => round.matches);
  if (nonFinalNodes.some((node) =>
    winnerSourceConsumers.get(node.id) !== 1
  )) {
    invariant("Every non-final bracket node must feed exactly one next-round slot.");
  }
}

function singleStructuralWinner(
  node: PublishBracketInput["bracket"]["rounds"][number]["matches"][number]
): TournamentTeamId {
  const teams = node.slots.flatMap((slot) =>
    slot.sourceType === "team" && slot.teamId !== undefined ? [slot.teamId] : []
  );
  const byes = node.slots.filter((slot) => slot.sourceType === "bye");
  if (teams.length !== 1 || byes.length !== 1) {
    invariant("A structural bye node must contain exactly one team and one bye.");
  }
  return teams[0] as TournamentTeamId;
}

function isStructuralByeNode(
  node: PublishBracketInput["bracket"]["rounds"][number]["matches"][number]
): boolean {
  return !node.playable &&
    node.slots.filter((slot) => slot.sourceType === "team").length === 1 &&
    node.slots.filter((slot) => slot.sourceType === "bye").length === 1;
}

async function dependentMatchStarted(
  executor: EnginePostgresExecutor,
  bracketMatchId: string
): Promise<boolean> {
  return (await executor.query(`
    SELECT 1
    FROM engine_bracket_slots slot
    JOIN engine_bracket_matches destination
      ON destination.id = slot.bracket_match_id
    JOIN engine_matches match ON match.id = destination.match_id
    WHERE slot.source_bracket_match_id = $1::uuid
      AND match.participants_frozen_at IS NOT NULL
    LIMIT 1
  `, [bracketMatchId])).rows[0] !== undefined;
}

async function readMatchContext(
  executor: EnginePostgresExecutor,
  tournamentId: TournamentId,
  matchId: MatchId
): Promise<MatchContextRow> {
  const row = (await executor.query<MatchContextRow>(`
    SELECT tournament.row_version AS tournament_row_version,
           match.row_version AS match_row_version, tournament.lifecycle,
           match.public_key, match.stage, match.pod_id::text,
           match.status, match.score_availability,
           match.active_revision_id::text,
           winning_team.team_id::text AS winner_team_id,
           pod.active_finalization_id::text,
           bracket_match.id::text AS bracket_match_id
    FROM engine_matches match
    JOIN engine_tournaments tournament ON tournament.id = match.tournament_id
    LEFT JOIN engine_pods pod ON pod.id = match.pod_id
    LEFT JOIN engine_match_revision_teams winning_team
      ON winning_team.revision_id = match.active_revision_id
     AND winning_team.result = 'win'
    LEFT JOIN engine_active_brackets active_bracket
      ON active_bracket.tournament_id = match.tournament_id
    LEFT JOIN engine_bracket_matches bracket_match
      ON bracket_match.bracket_id = active_bracket.bracket_id
     AND bracket_match.match_id = match.id
    WHERE match.tournament_id = $1::uuid AND match.id = $2::uuid
      AND NOT match.identity_only
  `, [tournamentId, matchId])).rows[0];
  if (row === undefined) invariant("Writable match was not found.");
  return row;
}

function validateOperatorCommand(
  input: PreviewOperatorMatchResolutionInput,
  context: MatchContextRow
): void {
  if (input.reason.trim().length === 0 || input.reason.length > 500) {
    invariant("Operator resolution reason must contain 1 to 500 characters.");
  }
  if ((input.commandType === "forfeit") !== (input.winnerTeamId !== undefined)) {
    invariant("Forfeit requires one winner; cancellation and postponement forbid one.");
  }
  if (
    context.stage === "playoffs" &&
      !["playoffs", "completed"].includes(context.lifecycle) ||
    context.stage === "pod_play" && ![
      "setup_published", "pod_play", "seeding_review"
    ].includes(context.lifecycle)
  ) invariant("Operator resolution is not allowed in this lifecycle.");
}

function operatorStatus(
  commandType: PreviewOperatorMatchResolutionInput["commandType"]
): "forfeited" | "cancelled" | "postponed" {
  return commandType === "forfeit"
    ? "forfeited"
    : commandType === "cancel" ? "cancelled" : "postponed";
}

async function authoritativeMatchParticipants(
  executor: EnginePostgresExecutor,
  tournamentId: TournamentId,
  matchId: MatchId,
  activeRevisionId: string | null
): Promise<readonly MatchRevisionTeamInput[]> {
  const teams = activeRevisionId === null
    ? (await executor.query<{
      side_number: 1 | 2;
      team_id: string;
      display_name: string;
    }>(`
      SELECT slot.slot_number AS side_number, slot.team_id::text,
             team.name AS display_name
      FROM engine_match_slots slot
      JOIN engine_teams team ON team.id = slot.team_id
      WHERE slot.tournament_id = $1::uuid AND slot.match_id = $2::uuid
      ORDER BY slot.slot_number
    `, [tournamentId, matchId])).rows
    : (await executor.query<{
      side_number: 1 | 2;
      team_id: string;
      display_name: string;
    }>(`
      SELECT side_number, team_id::text, display_name_at_revision AS display_name
      FROM engine_match_revision_teams
      WHERE tournament_id = $1::uuid AND revision_id = $2::uuid
      ORDER BY side_number
    `, [tournamentId, activeRevisionId])).rows;
  if (teams.length !== 2) invariant("Operator resolution requires two participants.");
  const results: MatchRevisionTeamInput[] = [];
  for (const team of teams) {
    const players = activeRevisionId === null
      ? (await executor.query<{
        player_id: string;
        membership_id: string;
        roster_slot: number;
        display_name: string;
      }>(`
        SELECT player.id::text AS player_id, membership.id::text AS membership_id,
               membership.roster_slot, player.display_name
        FROM engine_roster_memberships membership
        JOIN engine_players player ON player.id = membership.player_id
        WHERE membership.tournament_id = $1::uuid
          AND membership.team_id = $2::uuid AND membership.closed_at IS NULL
        ORDER BY membership.roster_slot
      `, [tournamentId, team.team_id])).rows
      : (await executor.query<{
        player_id: string;
        membership_id: string | null;
        roster_slot: number;
        display_name: string;
      }>(`
        SELECT player_id::text, roster_membership_id::text AS membership_id,
               roster_slot, display_name_at_revision AS display_name
        FROM engine_match_revision_players
        WHERE tournament_id = $1::uuid AND revision_id = $2::uuid
          AND team_id = $3::uuid
        ORDER BY roster_slot
      `, [tournamentId, activeRevisionId, team.team_id])).rows;
    results.push({
      sideNumber: team.side_number,
      teamId: parseStableUuid(team.team_id, "tournament_team"),
      displayName: team.display_name,
      result: "pending",
      players: players.map((player) => ({
        playerId: parseStableUuid(player.player_id, "tournament_player"),
        ...(player.membership_id === null ? {} : {
          rosterMembershipId: parseStableUuid(
            player.membership_id, "roster_membership"
          )
        }),
        rosterSlot: player.roster_slot,
        displayName: player.display_name
      }))
    });
  }
  return results;
}

function operatorTeams(
  participants: readonly MatchRevisionTeamInput[],
  commandType: RecordOperatorMatchResolutionInput["commandType"],
  winnerTeamId?: TournamentTeamId
): readonly MatchRevisionTeamInput[] {
  if (commandType === "forfeit" &&
      !participants.some((team) => team.teamId === winnerTeamId)) {
    invariant("Forfeit winner must be one of the authoritative match participants.");
  }
  return participants.map((team) => ({
    ...team,
    result: commandType === "forfeit"
      ? team.teamId === winnerTeamId ? "win" : "forfeited"
      : commandType === "cancel" ? "cancelled" : "pending"
  }));
}

interface MatchContextRow {
  tournament_row_version: string | number;
  match_row_version: string | number;
  lifecycle: TournamentProgressionRecord["lifecycle"];
  public_key: string;
  stage: "pod_play" | "playoffs";
  pod_id: string | null;
  status: string;
  score_availability: string;
  active_revision_id: string | null;
  winner_team_id: string | null;
  active_finalization_id: string | null;
  bracket_match_id: string | null;
}

interface ProgressionTournamentRow {
  id: string;
  lifecycle: TournamentProgressionRecord["lifecycle"];
  row_version: string | number;
  qualifiers_per_pod: number;
  bracket_size: number;
}

interface ProgressionPodRow {
  id: string;
  public_key: string;
  name: string;
  sequence: number;
  calculation_id: string | null;
  calculation_status: PodStandingCalculation["status"] | null;
  finalization_id: string | null;
  finalized_at: Date | string | null;
}

interface ProgressionStandingRow {
  calculation_id: string;
  team_id: string;
  team_name: string;
  rank: number | null;
  wins: number;
  losses: number;
  cup_differential: number;
  makes: number | null;
  attempts: number | null;
  shooting_percentage: string | number | null;
  qualified: boolean;
  tie_group: string | null;
  administrator_resolution: string | null;
}

interface ProgressionSeedRow {
  calculation_id: string | null;
  team_id: string;
  calculated_seed: number;
  effective_seed: number;
  override_id: string | null;
  override_command_id: string | null;
  override_digest: string | null;
  override_reason: string | null;
  overridden_by_admin_id: string | null;
  overridden_at: Date | string | null;
}

interface ProgressionBracketRow {
  bracket_id: string;
  public_key: string;
  name: string;
  status: "draft" | "published" | "completed";
  cumulative_workbook_id: string;
}

interface ProgressionBracketMatchRow {
  round_id: string;
  round_public_key: string;
  round_name: string;
  round_sequence: number;
  bracket_match_id: string;
  public_key: string;
  sequence: number;
  playable: boolean;
  match_id: string | null;
  instance_number: number | null;
  side_one_team_id: string | null;
  side_two_team_id: string | null;
  participants_frozen: boolean | null;
  match_status: BracketMatchRecord["matchStatus"] | null;
  score_availability: BracketMatchRecord["scoreAvailability"] | null;
  resolution_id: string | null;
  winner_team_id: string | null;
}

interface ProgressionBracketSlotRow {
  bracket_match_id: string;
  slot_number: 1 | 2;
  source_type: "team" | "match_winner" | "bye" | "tbd";
  team_id: string | null;
  team_name: string | null;
  source_bracket_match_id: string | null;
  seed: number | null;
}

export class PostgresTournamentProgressionRepository
implements TournamentProgressionRepositoryContract {
  private readonly transactions: TournamentEngineTransactionManager;
  private readonly writerRepository: PostgresMatchWriterRepository;
  private readonly revisionRepository: PostgresMatchRevisionRepository;
  private readonly statisticRepository: PostgresCanonicalStatisticRepository;

  constructor(
    private readonly database: PostgresDatabase,
    transactions?: TournamentEngineTransactionManager
  ) {
    this.transactions = transactions ?? new TournamentEngineTransactionManager(database);
    this.writerRepository = new PostgresMatchWriterRepository(database, this.transactions);
    this.revisionRepository = new PostgresMatchRevisionRepository(database, this.transactions);
    this.statisticRepository = new PostgresCanonicalStatisticRepository(database);
  }

  readProgression(
    tournamentId: TournamentId
  ): Promise<TournamentProgressionRecord | null> {
    return this.transactions.run(
      (transaction) => this.readProgressionInTransaction(tournamentId, transaction),
      { isolationLevel: "repeatable read", readOnly: true }
    );
  }

  activatePodStandings(
    input: ActivatePodStandingsInput
  ): Promise<ActivatePodStandingsResult> {
    return this.transactions.run((transaction) =>
      this.activatePodStandingsInTransaction(input, transaction)
    );
  }

  resolvePodTie(input: ResolvePodTieInput): Promise<ActivatePodStandingsResult> {
    return this.transactions.run((transaction) =>
      this.resolvePodTieInTransaction(input, transaction)
    );
  }

  finalizePod(input: FinalizePodInput): Promise<FinalizePodResult> {
    return this.transactions.run((transaction) =>
      this.finalizePodInTransaction(input, transaction)
    );
  }

  invalidatePodFinalization(
    input: InvalidatePodFinalizationInput
  ): Promise<ActivatePodStandingsResult> {
    return this.transactions.run((transaction) =>
      this.invalidatePodFinalizationInTransaction(input, transaction)
    );
  }

  activateGlobalSeeds(input: ActivateGlobalSeedsInput): Promise<ActiveSeedResult> {
    return this.transactions.run((transaction) =>
      this.activateGlobalSeedsInTransaction(input, transaction)
    );
  }

  resolveGlobalSeedTie(input: ResolveGlobalSeedTieInput): Promise<GlobalSeedReviewResult> {
    return this.transactions.run((transaction) =>
      this.resolveGlobalSeedTieInTransaction(input, transaction)
    );
  }

  applySeedOverridePermutation(
    input: ApplySeedOverridePermutationInput
  ): Promise<ActiveSeedResult> {
    return this.transactions.run((transaction) =>
      this.applySeedOverridePermutationInTransaction(input, transaction)
    );
  }

  publishBracket(input: PublishBracketInput): Promise<PublishBracketResult> {
    return this.transactions.run((transaction) =>
      this.publishBracketInTransaction(input, transaction)
    );
  }

  resolveBracketMatch(
    input: ResolveBracketMatchInput
  ): Promise<ResolveBracketMatchResult> {
    return this.transactions.run((transaction) =>
      this.resolveBracketMatchInTransaction(input, transaction)
    );
  }

  replaceStartedDependentMatch(
    input: ReplaceStartedDependentMatchInput
  ): Promise<ReplaceStartedDependentMatchResult> {
    return this.transactions.run((transaction) =>
      this.replaceStartedDependentMatchInTransaction(input, transaction)
    );
  }

  previewOperatorMatchResolution(
    input: PreviewOperatorMatchResolutionInput
  ): Promise<OperatorMatchResolutionPreview> {
    return this.transactions.run((transaction) =>
      this.previewOperatorMatchResolutionInTransaction(input, transaction),
    { isolationLevel: "repeatable read", readOnly: true });
  }

  recordOperatorMatchResolution(
    input: RecordOperatorMatchResolutionInput
  ): Promise<RecordOperatorMatchResolutionResult> {
    return this.transactions.run((transaction) =>
      this.recordOperatorMatchResolutionInTransaction(input, transaction)
    );
  }

  recordOperatorMatchResolutionWithCascade(
    input: RecordOperatorMatchResolutionWithCascadeInput
  ): Promise<RecordOperatorMatchResolutionWithCascadeResult> {
    return this.transactions.run((transaction) =>
      this.recordOperatorMatchResolutionInTransaction(input, transaction, input)
    ) as Promise<RecordOperatorMatchResolutionWithCascadeResult>;
  }

  async readProgressionInTransaction(
    tournamentId: TournamentId,
    transaction: TransactionContext
  ): Promise<TournamentProgressionRecord | null> {
    const executor = engineExecutor(this.database, transaction);
    const tournament = (await executor.query<ProgressionTournamentRow>(`
      SELECT tournament.id::text, tournament.lifecycle, tournament.row_version,
             configuration.qualifiers_per_pod, configuration.bracket_size
      FROM engine_tournaments tournament
      JOIN engine_tournament_configurations configuration
        ON configuration.tournament_id = tournament.id
      WHERE tournament.id = $1::uuid
    `, [tournamentId])).rows[0];
    if (tournament === undefined) return null;

    const pods = (await executor.query<ProgressionPodRow>(`
      SELECT pod.id::text, pod.public_key, pod.name, pod.sequence,
             active.calculation_id::text,
             calculation.status AS calculation_status,
             pod.active_finalization_id::text AS finalization_id,
             finalization.finalized_at
      FROM engine_pods pod
      LEFT JOIN engine_active_pod_standing_calculations active
        ON active.tournament_id = pod.tournament_id AND active.pod_id = pod.id
      LEFT JOIN engine_standing_calculations calculation
        ON calculation.id = active.calculation_id
      LEFT JOIN engine_pod_finalizations finalization
        ON finalization.id = pod.active_finalization_id
      WHERE pod.tournament_id = $1::uuid
      ORDER BY pod.sequence, pod.id
    `, [tournamentId])).rows;
    const standings = (await executor.query<ProgressionStandingRow>(`
      SELECT row.calculation_id::text, row.team_id::text, team.name AS team_name,
             row.rank, row.wins, row.losses, row.cup_differential,
             row.makes, row.attempts, row.shooting_percentage,
             row.qualified, row.tie_group, row.administrator_resolution
      FROM engine_active_pod_standing_calculations active
      JOIN engine_standing_rows row ON row.calculation_id = active.calculation_id
      JOIN engine_teams team ON team.id = row.team_id
      WHERE active.tournament_id = $1::uuid
      ORDER BY active.pod_id, row.rank NULLS LAST, row.public_key
    `, [tournamentId])).rows;
    const seedRows = (await executor.query<ProgressionSeedRow>(`
      SELECT active.calculation_id::text, seed.team_id::text,
             seed.calculated_seed, seed.effective_seed, seed.override_id::text,
             override_active.command_id::text AS override_command_id,
             override_command.override_digest,
             override_command.reason AS override_reason,
             override_command.overridden_by_admin_id::text,
             override_command.overridden_at
      FROM engine_effective_seeds seed
      LEFT JOIN engine_active_seed_calculations active
        ON active.tournament_id = seed.tournament_id
      LEFT JOIN engine_active_seed_override_commands override_active
        ON override_active.tournament_id = seed.tournament_id
      LEFT JOIN engine_seed_override_commands override_command
        ON override_command.id = override_active.command_id
      WHERE seed.tournament_id = $1::uuid
      ORDER BY seed.effective_seed
    `, [tournamentId])).rows;
    const review = (await executor.query<{
      review_version_id: string;
      seed_calculation_id: string;
      status: "unresolved_tie" | "complete";
      input_digest: string;
      rules_version: number;
      tie_groups: unknown;
    }>(`
      SELECT review.id::text AS review_version_id,
             review.seed_calculation_id::text, review.status,
             review.input_digest, review.rules_version, review.tie_groups
      FROM engine_active_global_seed_reviews active
      JOIN engine_global_seed_review_versions review
        ON review.id = active.review_version_id
      WHERE active.tournament_id = $1::uuid
    `, [tournamentId])).rows[0];
    const bracket = (await executor.query<ProgressionBracketRow>(`
      SELECT bracket.id::text AS bracket_id, bracket.public_key, bracket.name,
             bracket.status, publication.cumulative_workbook_id::text
      FROM engine_active_brackets active
      JOIN engine_brackets bracket ON bracket.id = active.bracket_id
      JOIN engine_bracket_publications publication
        ON publication.id = active.publication_id
      WHERE active.tournament_id = $1::uuid
    `, [tournamentId])).rows[0];

    return {
      tournamentId,
      lifecycle: tournament.lifecycle,
      rowVersion: Number(tournament.row_version),
      qualifiersPerPod: tournament.qualifiers_per_pod,
      bracketSize: tournament.bracket_size,
      pods: pods.map((pod) => mapPod(pod, standings)),
      ...(review === undefined ? {} : {
        activeGlobalSeedReview: {
          reviewVersionId: review.review_version_id,
          seedCalculationId: review.seed_calculation_id,
          inputDigest: review.input_digest,
          rulesVersion: review.rules_version,
          status: review.status,
          tieGroups: readTieGroups(review.tie_groups)
        }
      }),
      ...(seedRows[0]?.calculation_id === null || seedRows[0] === undefined
        ? {}
        : { activeSeedCalculationId: seedRows[0].calculation_id }),
      effectiveSeeds: seedRows.map(mapSeed),
      ...(seedRows[0]?.override_command_id === null || seedRows[0] === undefined
        ? {}
        : { activeSeedOverrideCommandId: seedRows[0].override_command_id }),
      ...(seedRows[0]?.override_command_id === null || seedRows[0] === undefined
        ? {}
        : {
          activeSeedOverride: {
            commandId: seedRows[0].override_command_id,
            reason: seedRows[0].override_reason ?? "",
            administratorId: seedRows[0].overridden_by_admin_id ?? "",
            occurredAt: toIso(seedRows[0].overridden_at),
            overrideDigest: seedRows[0].override_digest ?? ""
          }
        }),
      ...(bracket === undefined ? {} : {
        activeBracket: await this.readBracket(executor, tournamentId, bracket)
      })
    };
  }

  async activatePodStandingsInTransaction(
    input: ActivatePodStandingsInput,
    transaction: TransactionContext
  ): Promise<ActivatePodStandingsResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const tournament = await this.lockTournament(executor, input.tournamentId);
    assertTournamentVersion(tournament, input.expectedTournamentRowVersion);
    if (![
      "setup_published", "pod_play", "seeding_review"
    ].includes(tournament.lifecycle)) {
      invariant("Pod standings cannot activate in this tournament lifecycle.");
    }
    assertPodArtifact(input);
    await this.persistPodStandingArtifact(executor, input.artifact);
    if (input.resolution !== undefined) {
      await this.persistPodResolution(executor, input);
    }
    await executor.query(`
      INSERT INTO engine_active_pod_standing_calculations (
        tournament_id, pod_id, calculation_id, activated_at
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
      ON CONFLICT (tournament_id, pod_id) DO UPDATE SET
        calculation_id = EXCLUDED.calculation_id,
        activated_at = EXCLUDED.activated_at
    `, [
      input.tournamentId, input.podId, input.artifact.calculationId,
      input.activatedAt
    ]);
    const lifecycle = tournament.lifecycle === "setup_published"
      ? "pod_play" as const
      : tournament.lifecycle;
    const rowVersion = await updateTournamentVersion(
      executor, input.tournamentId, input.expectedTournamentRowVersion,
      lifecycle, input.activatedAt
    );
    await safeAudit(executor, {
      tournamentId: input.tournamentId,
      commandType: input.resolution === undefined
        ? "pod_standings_activated"
        : "pod_standing_tie_resolved",
      actorId: input.resolution?.administratorId,
      occurredAt: input.activatedAt,
      details: {
        podId: input.podId,
        calculationId: input.artifact.calculationId,
        status: input.artifact.calculation.status,
        ...(input.resolution === undefined ? {} : {
          confirmationDigest: input.resolution.confirmationDigest,
          resolutionCommandId: input.resolution.commandId
        })
      }
    });
    return {
      tournamentId: input.tournamentId,
      podId: input.podId,
      calculationId: input.artifact.calculationId,
      calculationStatus: input.artifact.calculation.status,
      lifecycle,
      tournamentRowVersion: rowVersion
    };
  }

  async resolvePodTieInTransaction(
    input: ResolvePodTieInput,
    transaction: TransactionContext
  ): Promise<ActivatePodStandingsResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const active = (await executor.query<{ calculation_id: string }>(`
      SELECT calculation_id::text
      FROM engine_active_pod_standing_calculations
      WHERE tournament_id = $1::uuid AND pod_id = $2::uuid
      FOR UPDATE
    `, [input.tournamentId, input.podId])).rows[0];
    if (active?.calculation_id !== input.activeCalculationId) {
      conflict("Pod standings changed after the tie preview was prepared.");
    }
    const source = await this.authoritativePodStandingInput(
      executor, input.tournamentId, input.podId
    );
    const priorResolutions = await readPodTieResolutions(
      executor, input.activeCalculationId
    );
    const resolution: PodStandingTieResolution = {
      resolutionId: input.commandId,
      tieGroupId: input.tieGroupId,
      orderedTeamIds: input.orderedTeamIds,
      reason: input.reason,
      resolvedBy: input.administratorId,
      resolvedAt: input.occurredAt
    };
    const calculationSource = {
      ...source,
      tieResolutions: [...priorResolutions, resolution]
    };
    const calculation = calculatePodStandings(calculationSource);
    return this.activatePodStandingsInTransaction({
      tournamentId: input.tournamentId,
      podId: input.podId,
      expectedTournamentRowVersion: input.expectedTournamentRowVersion,
      artifact: artifactFromCalculation(
        input.replacementCalculationId, calculationSource, calculation,
        input.occurredAt
      ),
      resolution: {
        commandId: input.commandId,
        sourceCalculationId: input.activeCalculationId,
        confirmationDigest: input.confirmationDigest,
        administratorId: input.administratorId,
        occurredAt: input.occurredAt,
        reason: input.reason
      },
      activatedAt: input.occurredAt
    }, transaction);
  }

  async finalizePodInTransaction(
    input: FinalizePodInput,
    transaction: TransactionContext
  ): Promise<FinalizePodResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const tournament = await this.lockTournament(executor, input.tournamentId);
    assertTournamentVersion(tournament, input.expectedTournamentRowVersion);
    if (!["pod_play", "seeding_review"].includes(tournament.lifecycle)) {
      invariant("A pod can be finalized only during pod play or seeding review.");
    }
    const calculation = (await executor.query<{
      status: string;
      active: boolean;
    }>(`
      SELECT calculation.status,
             active.calculation_id IS NOT NULL AS active
      FROM engine_standing_calculations calculation
      LEFT JOIN engine_active_pod_standing_calculations active
        ON active.tournament_id = calculation.tournament_id
       AND active.pod_id = calculation.pod_id
       AND active.calculation_id = calculation.id
      WHERE calculation.tournament_id = $1::uuid
        AND calculation.pod_id = $2::uuid
        AND calculation.id = $3::uuid
      FOR UPDATE OF calculation
    `, [input.tournamentId, input.podId, input.calculationId])).rows[0];
    if (calculation === undefined || !calculation.active) {
      conflict("Only the active pod standing calculation may be finalized.");
    }
    const incomplete = (await executor.query<{
      blocking_count: string;
      unranked_count: string;
    }>(`
      SELECT
        (SELECT count(*)::text
         FROM engine_standing_calculation_matches source
         WHERE source.calculation_id = $1::uuid
           AND source.disposition = 'blocking') AS blocking_count,
        (SELECT count(*)::text
         FROM engine_standing_rows row
         WHERE row.calculation_id = $1::uuid AND row.rank IS NULL) AS unranked_count
    `, [input.calculationId])).rows[0];
    if (calculation.status !== "finalizable" ||
        Number(incomplete?.blocking_count ?? 1) !== 0 ||
        Number(incomplete?.unranked_count ?? 1) !== 0) {
      invariant("Pod finalization requires complete standings with every tie resolved.");
    }
    const existing = (await executor.query<{ active_finalization_id: string | null }>(`
      SELECT active_finalization_id::text
      FROM engine_pods
      WHERE tournament_id = $1::uuid AND id = $2::uuid
      FOR UPDATE
    `, [input.tournamentId, input.podId])).rows[0];
    if (existing === undefined || existing.active_finalization_id !== null) {
      conflict("Pod finalization is missing or has already been selected.");
    }
    const overrideRows = (await executor.query<{
      team_id: string;
      tie_group: string;
      resolved_rank: number;
      administrator_resolution: unknown;
    }>(`
      SELECT team_id::text, tie_group, rank AS resolved_rank,
             administrator_resolution
      FROM engine_standing_rows
      WHERE tournament_id = $1::uuid
        AND calculation_id = $2::uuid
        AND administrator_resolution IS NOT NULL
      ORDER BY tie_group, rank, team_id
    `, [input.tournamentId, input.calculationId])).rows;
    const overrideDigest = canonicalSha256({
      contract: "pod-finalization-overrides-v1",
      tournamentId: input.tournamentId,
      podId: input.podId,
      calculationId: input.calculationId,
      rows: overrideRows.map((row) => ({
        teamId: row.team_id,
        tieGroupId: row.tie_group,
        resolvedRank: row.resolved_rank,
        administratorResolution: row.administrator_resolution
      }))
    });
    await executor.query(`
      INSERT INTO engine_pod_finalizations (
        id, tournament_id, pod_id, calculation_id, finalized_by,
        reason, finalized_at, metadata
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8::jsonb)
    `, [
      input.finalizationId, input.tournamentId, input.podId,
      input.calculationId, input.administratorId, input.reason ?? null,
      input.occurredAt, writeEngineJson(input.metadata ?? {})
    ]);
    await executor.query(`
      INSERT INTO engine_pod_finalization_provenance (
        finalization_id, tournament_id, pod_id, calculation_id,
        override_digest, confirmation_digest, finalized_by_admin_id, metadata
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        $5, $6, $7::uuid, $8::jsonb
      )
    `, [
      input.finalizationId, input.tournamentId, input.podId,
      input.calculationId, overrideDigest,
      requireDigest(input.confirmationDigest), input.administratorId,
      writeEngineJson(input.metadata ?? {})
    ]);
    await executor.query(`
      UPDATE engine_pods SET active_finalization_id = $3::uuid
      WHERE tournament_id = $1::uuid AND id = $2::uuid
    `, [input.tournamentId, input.podId, input.finalizationId]);
    const counts = (await executor.query<{
      pod_count: string;
      finalized_count: string;
    }>(`
      SELECT count(*)::text AS pod_count,
             count(active_finalization_id)::text AS finalized_count
      FROM engine_pods WHERE tournament_id = $1::uuid
    `, [input.tournamentId])).rows[0];
    const allPodsFinalized = counts !== undefined &&
      counts.pod_count === counts.finalized_count;
    const lifecycle = allPodsFinalized ? "seeding_review" as const : tournament.lifecycle;
    const rowVersion = await updateTournamentVersion(
      executor, input.tournamentId, input.expectedTournamentRowVersion,
      lifecycle, input.occurredAt
    );
    const globalSeedReview = allPodsFinalized
      ? await this.createGlobalSeedReview(
        executor, input.tournamentId, input.occurredAt, rowVersion
      )
      : undefined;
    await safeAudit(executor, {
      tournamentId: input.tournamentId,
      commandType: "pod_finalized",
      actorId: input.administratorId,
      occurredAt: input.occurredAt,
      details: {
        podId: input.podId,
        calculationId: input.calculationId,
        finalizationId: input.finalizationId,
        confirmationDigest: input.confirmationDigest,
        allPodsFinalized
      }
    });
    return {
      tournamentId: input.tournamentId,
      podId: input.podId,
      finalizationId: input.finalizationId,
      allPodsFinalized,
      lifecycle,
      tournamentRowVersion: globalSeedReview?.activeSeeds?.tournamentRowVersion ?? rowVersion,
      ...(globalSeedReview === undefined ? {} : { globalSeedReview })
    };
  }

  async invalidatePodFinalizationInTransaction(
    input: InvalidatePodFinalizationInput,
    transaction: TransactionContext
  ): Promise<ActivatePodStandingsResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const tournament = await this.lockTournament(executor, input.tournamentId);
    assertTournamentVersion(tournament, input.expectedTournamentRowVersion);
    if (tournament.lifecycle !== "seeding_review") {
      invariant("Finalized pods may be invalidated only during seeding review.");
    }
    if (await hasActiveBracket(executor, input.tournamentId)) {
      invariant("A published bracket blocks implicit pod-finalization invalidation.");
    }
    const pod = (await executor.query<{
      active_finalization_id: string | null;
      calculation_id: string | null;
      status: PodStandingCalculation["status"] | null;
    }>(`
      SELECT pod.active_finalization_id::text,
             active.calculation_id::text, calculation.status
      FROM engine_pods pod
      LEFT JOIN engine_active_pod_standing_calculations active
        ON active.tournament_id = pod.tournament_id AND active.pod_id = pod.id
      LEFT JOIN engine_standing_calculations calculation
        ON calculation.id = active.calculation_id
      WHERE pod.tournament_id = $1::uuid AND pod.id = $2::uuid
      FOR UPDATE OF pod
    `, [input.tournamentId, input.podId])).rows[0];
    if (
      pod?.active_finalization_id === null ||
      pod?.active_finalization_id === undefined ||
      pod.calculation_id !== input.replacementCalculationId
    ) {
      conflict("The active pod finalization or replacement standings changed.");
    }
    await executor.query(`
      INSERT INTO engine_pod_finalization_invalidations (
        id, tournament_id, pod_id, finalization_id,
        replacement_calculation_id, correction_match_id,
        correction_revision_id, confirmation_digest, reason,
        invalidated_by_admin_id, invalidated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        $5::uuid, $6::uuid, $7::uuid, $8, $9, $10::uuid, $11
      )
    `, [
      input.invalidationId, input.tournamentId, input.podId,
      pod.active_finalization_id, input.replacementCalculationId,
      input.correctionMatchId, input.correctionRevisionId,
      requireDigest(input.confirmationDigest), input.reason,
      input.administratorId, input.occurredAt
    ]);
    await this.clearDerivedSeedState(executor, input.tournamentId, input.podId);
    const rowVersion = await updateTournamentVersion(
      executor, input.tournamentId, input.expectedTournamentRowVersion,
      "seeding_review", input.occurredAt
    );
    await safeAudit(executor, {
      tournamentId: input.tournamentId,
      matchId: input.correctionMatchId,
      commandType: "pod_finalization_invalidated",
      actorId: input.administratorId,
      occurredAt: input.occurredAt,
      details: {
        podId: input.podId,
        finalizationId: pod.active_finalization_id,
        replacementCalculationId: input.replacementCalculationId,
        correctionRevisionId: input.correctionRevisionId,
        confirmationDigest: input.confirmationDigest
      }
    });
    return {
      tournamentId: input.tournamentId,
      podId: input.podId,
      calculationId: input.replacementCalculationId,
      calculationStatus: pod.status ?? "provisional",
      lifecycle: "seeding_review",
      tournamentRowVersion: rowVersion
    };
  }

  async activateGlobalSeedsInTransaction(
    input: ActivateGlobalSeedsInput,
    transaction: TransactionContext
  ): Promise<ActiveSeedResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const tournament = await this.lockTournament(executor, input.tournamentId);
    assertTournamentVersion(tournament, input.expectedTournamentRowVersion);
    if (tournament.lifecycle !== "seeding_review") {
      invariant("Global seeds may activate only during seeding review.");
    }
    if (await hasActiveBracket(executor, input.tournamentId)) {
      invariant("Calculated seeds cannot change after bracket publication.");
    }
    requireDigest(input.inputDigest);
    requirePositive(input.rulesVersion, "Seed rules version");
    const activeFinalizations = await readActiveFinalizationIds(
      executor, input.tournamentId
    );
    assertExactStrings(
      input.podFinalizationIds, activeFinalizations,
      "Seed calculation must reference every active pod finalization"
    );
    const qualified = input.rows.filter((row) => row.qualified);
    assertSeedPermutation(qualified.map((row) => row.calculatedSeed));
    if (qualified.length !== input.rows.length) {
      invariant("Canonical global seed rows must contain qualifiers only.");
    }
    await executor.query(`
      INSERT INTO engine_seed_calculations (
        id, tournament_id, input_digest, rules_version, created_at, metadata
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)
    `, [
      input.calculationId, input.tournamentId, input.inputDigest,
      input.rulesVersion, input.createdAt, writeEngineJson(input.metadata ?? {})
    ]);
    for (const row of input.rows) {
      await executor.query(`
        INSERT INTO engine_seed_rows (
          id, tournament_id, calculation_id, team_id, public_key,
          calculated_seed, qualified, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, true, $7::jsonb
        )
      `, [
        row.rowId, input.tournamentId, input.calculationId, row.teamId,
        row.publicKey, row.calculatedSeed, writeEngineJson(row.metadata ?? {})
      ]);
    }
    const finalizationRows = await executor.query<{
      pod_id: string;
      active_finalization_id: string;
    }>(`
      SELECT id::text AS pod_id, active_finalization_id::text
      FROM engine_pods
      WHERE tournament_id = $1::uuid
      ORDER BY sequence
    `, [input.tournamentId]);
    for (const row of finalizationRows.rows) {
      await executor.query(`
        INSERT INTO engine_seed_calculation_finalizations (
          tournament_id, calculation_id, pod_id, finalization_id
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
      `, [
        input.tournamentId, input.calculationId,
        row.pod_id, row.active_finalization_id
      ]);
    }
    await executor.query(`
      INSERT INTO engine_active_seed_calculations (
        tournament_id, calculation_id, activated_at
      ) VALUES ($1::uuid, $2::uuid, $3)
      ON CONFLICT (tournament_id) DO UPDATE SET
        calculation_id = EXCLUDED.calculation_id,
        activated_at = EXCLUDED.activated_at
    `, [input.tournamentId, input.calculationId, input.createdAt]);
    await executor.query(`
      DELETE FROM engine_active_seed_override_commands
      WHERE tournament_id = $1::uuid
    `, [input.tournamentId]);
    await executor.query(`
      DELETE FROM engine_effective_seeds WHERE tournament_id = $1::uuid
    `, [input.tournamentId]);
    for (const row of input.rows) {
      await executor.query(`
        INSERT INTO engine_effective_seeds (
          tournament_id, team_id, calculated_seed, effective_seed,
          override_id, updated_at
        ) VALUES ($1::uuid, $2::uuid, $3, $3, NULL, $4)
      `, [input.tournamentId, row.teamId, row.calculatedSeed, input.createdAt]);
    }
    const rowVersion = await updateTournamentVersion(
      executor, input.tournamentId, input.expectedTournamentRowVersion,
      "seeding_review", input.createdAt
    );
    await safeAudit(executor, {
      tournamentId: input.tournamentId,
      commandType: "global_seeds_activated",
      occurredAt: input.createdAt,
      details: {
        seedCalculationId: input.calculationId,
        inputDigest: input.inputDigest,
        qualifierCount: input.rows.length
      }
    });
    return {
      tournamentId: input.tournamentId,
      calculationId: input.calculationId,
      effectiveSeeds: input.rows.map((row) => ({
        teamId: row.teamId,
        calculatedSeed: row.calculatedSeed,
        effectiveSeed: row.calculatedSeed
      })),
      tournamentRowVersion: rowVersion
    };
  }

  async resolveGlobalSeedTieInTransaction(
    input: ResolveGlobalSeedTieInput,
    transaction: TransactionContext
  ): Promise<GlobalSeedReviewResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const tournament = await this.lockTournament(executor, input.tournamentId);
    assertTournamentVersion(tournament, input.expectedTournamentRowVersion);
    const active = (await executor.query<{
      review_version_id: string;
      seed_calculation_id: string;
      calculation_input: unknown;
    }>(`
      SELECT review.id::text AS review_version_id,
             review.seed_calculation_id::text, review.calculation_input
      FROM engine_active_global_seed_reviews active
      JOIN engine_global_seed_review_versions review
        ON review.id = active.review_version_id
      WHERE active.tournament_id = $1::uuid
      FOR UPDATE OF active
    `, [input.tournamentId])).rows[0];
    if (
      active?.review_version_id !== input.activeReviewVersionId ||
      active.seed_calculation_id !== input.seedCalculationId
    ) {
      conflict("Global seed review changed after the tie preview was prepared.");
    }
    const authoritative = await this.authoritativeGlobalQualifiers(
      executor, input.tournamentId
    );
    const prior = await readGlobalTieResolutions(
      executor, input.tournamentId, input.seedCalculationId
    );
    const resolution: GlobalQualifierTieResolution = {
      resolutionId: input.commandId,
      tieGroupId: input.tieGroupId,
      orderedTeamIds: input.orderedTeamIds,
      reason: input.reason,
      resolvedBy: input.administratorId,
      resolvedAt: input.occurredAt
    };
    const source = {
      tournamentId: input.tournamentId,
      seedCalculationId: input.seedCalculationId,
      rulesVersion: GLOBAL_QUALIFIER_SEEDING_RULES_VERSION,
      ...authoritative,
      tieResolutions: [...prior, resolution]
    };
    const calculation = calculateGlobalQualifierSeeds(source);
    await this.persistGlobalSeedReview(
      executor, input.reviewVersionId, source, calculation, input.occurredAt
    );
    await executor.query(`
      INSERT INTO engine_global_seed_resolution_commands (
        id, tournament_id, seed_calculation_id, source_review_version_id,
        resolved_review_version_id, tie_group, confirmation_digest, reason,
        resolved_by_admin_id, resolved_at, ordered_team_ids
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        $5::uuid, $6, $7, $8, $9::uuid, $10, $11::uuid[]
      )
    `, [
      input.commandId, input.tournamentId, input.seedCalculationId,
      input.activeReviewVersionId, input.reviewVersionId, input.tieGroupId,
      requireDigest(input.confirmationDigest), input.reason,
      input.administratorId, input.occurredAt, input.orderedTeamIds
    ]);
    await this.activateGlobalSeedReview(
      executor, input.tournamentId, input.reviewVersionId,
      input.seedCalculationId, input.occurredAt
    );
    if (calculation.status !== "complete") {
      const rowVersion = await updateTournamentVersion(
        executor, input.tournamentId, input.expectedTournamentRowVersion,
        "seeding_review", input.occurredAt
      );
      await safeAudit(executor, {
        tournamentId: input.tournamentId,
        commandType: "global_seed_tie_resolved",
        actorId: input.administratorId,
        occurredAt: input.occurredAt,
        details: {
          reviewVersionId: input.reviewVersionId,
          seedCalculationId: input.seedCalculationId,
          tieGroupId: input.tieGroupId,
          confirmationDigest: input.confirmationDigest,
          status: calculation.status
        }
      });
      return {
        reviewVersionId: input.reviewVersionId,
        seedCalculationId: input.seedCalculationId,
        status: calculation.status,
        tournamentRowVersion: rowVersion,
        tieGroups: calculation.tieGroups.map((group) => ({
          tieGroupId: group.tieGroupId,
          teamIds: group.teamIds,
          resolved: group.resolved
        }))
      };
    }
    const activeSeeds = await this.materializeCompleteSeedReview(
      executor, input.tournamentId, input.seedCalculationId,
      calculation, input.occurredAt, input.expectedTournamentRowVersion,
      {
        actorId: input.administratorId,
        tieGroupId: input.tieGroupId,
        sourceReviewVersionId: input.activeReviewVersionId,
        resolvedReviewVersionId: input.reviewVersionId,
        confirmationDigest: input.confirmationDigest
      }
    );
    return {
      reviewVersionId: input.reviewVersionId,
      seedCalculationId: input.seedCalculationId,
      status: calculation.status,
      tournamentRowVersion: activeSeeds.tournamentRowVersion,
      tieGroups: calculation.tieGroups.map((group) => ({
        tieGroupId: group.tieGroupId,
        teamIds: group.teamIds,
        resolved: group.resolved
      })),
      activeSeeds
    };
  }

  async applySeedOverridePermutationInTransaction(
    input: ApplySeedOverridePermutationInput,
    transaction: TransactionContext
  ): Promise<ActiveSeedResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const tournament = await this.lockTournament(executor, input.tournamentId);
    assertTournamentVersion(tournament, input.expectedTournamentRowVersion);
    if (tournament.lifecycle !== "seeding_review") {
      invariant("Seed overrides may be applied only during seeding review.");
    }
    if (await hasActiveBracket(executor, input.tournamentId)) {
      invariant("Seed overrides are blocked after bracket publication.");
    }
    const active = (await executor.query<{ calculation_id: string }>(`
      SELECT calculation_id::text FROM engine_active_seed_calculations
      WHERE tournament_id = $1::uuid FOR UPDATE
    `, [input.tournamentId])).rows[0]?.calculation_id;
    if (active !== input.calculationId) {
      conflict("Calculated seeds changed after the override preview was prepared.");
    }
    const current = (await executor.query<{
      team_id: string;
      calculated_seed: number;
      effective_seed: number;
    }>(`
      SELECT team_id::text, calculated_seed, effective_seed
      FROM engine_effective_seeds
      WHERE tournament_id = $1::uuid
      ORDER BY effective_seed
      FOR UPDATE
    `, [input.tournamentId])).rows;
    assertExactStrings(
      input.rows.map((row) => row.teamId),
      current.map((row) => row.team_id),
      "A seed override must include every qualifier exactly once"
    );
    assertSeedPermutation(input.rows.map((row) => row.newSeed));
    const currentByTeam = new Map(current.map((row) => [row.team_id, row]));
    for (const row of input.rows) {
      const stored = currentByTeam.get(row.teamId);
      if (stored?.effective_seed !== row.previousSeed) {
        conflict("Effective seeds changed after the override preview was prepared.");
      }
      if ((row.previousSeed === row.newSeed) !== (row.overrideId === undefined)) {
        invariant("Changed seed rows require an override ID; unchanged rows forbid one.");
      }
    }
    if (input.rows.every((row) => row.previousSeed === row.newSeed)) {
      invariant("A seed override must change at least one effective seed.");
    }
    await executor.query(`
      INSERT INTO engine_seed_override_commands (
        id, tournament_id, calculation_id, override_digest,
        confirmation_digest, reason,
        overridden_by_admin_id, overridden_at, metadata
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
        $7::uuid, $8, $9::jsonb
      )
    `, [
      input.commandId, input.tournamentId, input.calculationId,
      requireDigest(input.overrideDigest), requireDigest(input.confirmationDigest), input.reason,
      input.administratorId, input.occurredAt,
      writeEngineJson(input.metadata ?? {})
    ]);
    const overrideByTeam = new Map<string, string>();
    for (const row of input.rows) {
      if (row.overrideId !== undefined) {
        await executor.query(`
          INSERT INTO engine_seed_overrides (
            id, tournament_id, team_id, previous_seed, new_seed, reason,
            overridden_by, overridden_at, metadata
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, '{}'::jsonb
          )
        `, [
          row.overrideId, input.tournamentId, row.teamId,
          row.previousSeed, row.newSeed, input.reason,
          input.administratorId, input.occurredAt
        ]);
        overrideByTeam.set(row.teamId, row.overrideId);
      }
      await executor.query(`
        INSERT INTO engine_seed_override_command_rows (
          command_id, tournament_id, team_id, previous_seed, new_seed,
          override_id
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)
      `, [
        input.commandId, input.tournamentId, row.teamId,
        row.previousSeed, row.newSeed, row.overrideId ?? null
      ]);
    }
    await executor.query(`
      DELETE FROM engine_effective_seeds WHERE tournament_id = $1::uuid
    `, [input.tournamentId]);
    for (const row of input.rows) {
      const stored = currentByTeam.get(row.teamId);
      if (stored === undefined) invariant("Validated seed row disappeared.");
      await executor.query(`
        INSERT INTO engine_effective_seeds (
          tournament_id, team_id, calculated_seed, effective_seed,
          override_id, updated_at
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6)
      `, [
        input.tournamentId, row.teamId, stored.calculated_seed,
        row.newSeed, overrideByTeam.get(row.teamId) ?? null, input.occurredAt
      ]);
    }
    await executor.query(`
      INSERT INTO engine_active_seed_override_commands (
        tournament_id, command_id, activated_at
      ) VALUES ($1::uuid, $2::uuid, $3)
      ON CONFLICT (tournament_id) DO UPDATE SET
        command_id = EXCLUDED.command_id,
        activated_at = EXCLUDED.activated_at
    `, [input.tournamentId, input.commandId, input.occurredAt]);
    const rowVersion = await updateTournamentVersion(
      executor, input.tournamentId, input.expectedTournamentRowVersion,
      "seeding_review", input.occurredAt
    );
    await safeAudit(executor, {
      tournamentId: input.tournamentId,
      commandType: "effective_seed_permutation_overridden",
      actorId: input.administratorId,
      occurredAt: input.occurredAt,
      details: {
        seedCalculationId: input.calculationId,
        overrideCommandId: input.commandId,
        confirmationDigest: input.confirmationDigest,
        changedCount: overrideByTeam.size
      }
    });
    return {
      tournamentId: input.tournamentId,
      calculationId: input.calculationId,
      effectiveSeeds: input.rows.map((row) => ({
        teamId: row.teamId,
        calculatedSeed: currentByTeam.get(row.teamId)?.calculated_seed ?? row.newSeed,
        effectiveSeed: row.newSeed,
        ...(row.overrideId === undefined ? {} : { overrideId: row.overrideId })
      })),
      tournamentRowVersion: rowVersion
    };
  }

  async publishBracketInTransaction(
    input: PublishBracketInput,
    transaction: TransactionContext
  ): Promise<PublishBracketResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const tournament = await this.lockTournament(executor, input.tournamentId);
    assertTournamentVersion(tournament, input.expectedTournamentRowVersion);
    if (tournament.lifecycle !== "seeding_review") {
      invariant("A bracket may be published only during seeding review.");
    }
    if (await hasActiveBracket(executor, input.tournamentId)) {
      conflict("This tournament already has a published bracket.");
    }
    if (input.bracket.bracketSize !== tournament.bracket_size) {
      invariant("Bracket topology does not match the copied tournament configuration.");
    }
    const activeSeed = (await executor.query<{ calculation_id: string }>(`
      SELECT calculation_id::text FROM engine_active_seed_calculations
      WHERE tournament_id = $1::uuid FOR UPDATE
    `, [input.tournamentId])).rows[0]?.calculation_id;
    if (activeSeed !== input.seedCalculationId) {
      conflict("Effective seeds changed after bracket preview was prepared.");
    }
    const activeOverride = (await executor.query<{ command_id: string }>(`
      SELECT command_id::text FROM engine_active_seed_override_commands
      WHERE tournament_id = $1::uuid
    `, [input.tournamentId])).rows[0]?.command_id;
    if (activeOverride !== input.seedOverrideCommandId) {
      conflict("The seed override changed after bracket preview was prepared.");
    }
    const effectiveSeeds = (await executor.query<{
      team_id: string;
      effective_seed: number;
    }>(`
      SELECT team_id::text, effective_seed
      FROM engine_effective_seeds WHERE tournament_id = $1::uuid
      ORDER BY effective_seed
    `, [input.tournamentId])).rows;
    validateBracketInput(input, effectiveSeeds, tournament.bracket_size);
    requireDigest(input.confirmationDigest);
    await executor.query(`
      INSERT INTO engine_brackets (
        id, tournament_id, public_key, name, bracket_size,
        placement_policy, status, published_at, created_at, metadata
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4, $5,
        'standard_mirrored_seeded', 'published', $6, $6, $7::jsonb
      )
    `, [
      input.bracket.id, input.tournamentId, input.bracket.publicKey,
      input.bracket.name, input.bracket.bracketSize, input.occurredAt,
      writeEngineJson(input.bracket.metadata ?? {})
    ]);
    for (const round of input.bracket.rounds) {
      await executor.query(`
        INSERT INTO engine_bracket_rounds (
          id, tournament_id, bracket_id, public_key, name, sequence, metadata
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb)
      `, [
        round.id, input.tournamentId, input.bracket.id, round.publicKey,
        round.name, round.sequence, writeEngineJson(round.metadata ?? {})
      ]);
    }
    let topologySequence = 0;
    const nodes = [...input.bracket.rounds]
      .sort((left, right) => left.sequence - right.sequence)
      .flatMap((round) => [...round.matches]
        .sort((left, right) => left.sequence - right.sequence)
        .map((node) => ({ round, node, topologySequence: ++topologySequence }))
      );
    const podSequenceOffset = Number((await executor.query<{ sequence: number }>(`
      SELECT COALESCE(MAX(sequence), 0)::integer AS sequence
      FROM engine_matches
      WHERE tournament_id = $1::uuid AND stage = 'pod_play'
    `, [input.tournamentId])).rows[0]?.sequence ?? 0);
    for (const { node, topologySequence: nodeTopologySequence } of nodes) {
      if (node.playable && node.match !== undefined) {
        await this.insertPlayoffMatch(
          executor, input.tournamentId, {
            ...node.match,
            sequence: podSequenceOffset + nodeTopologySequence
          }, input.occurredAt
        );
      }
    }
    for (const { round, node } of nodes) {
      await executor.query(`
        INSERT INTO engine_bracket_matches (
          id, tournament_id, bracket_id, round_id, match_id, public_key,
          sequence, playable, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9::jsonb
        )
      `, [
        node.id, input.tournamentId, input.bracket.id, round.id,
        node.match?.id ?? null, node.publicKey, node.sequence,
        node.playable, writeEngineJson(node.metadata ?? {})
      ]);
    }
    for (const { node } of nodes) {
      for (const slot of node.slots) {
        await executor.query(`
          INSERT INTO engine_bracket_slots (
            id, tournament_id, bracket_match_id, public_key, slot_number,
            source_type, team_id, source_bracket_match_id, seed, metadata
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4, $5,
            $6, $7::uuid, $8::uuid, $9, $10::jsonb
          )
        `, [
          slot.id, input.tournamentId, node.id, slot.publicKey,
          slot.slotNumber, slot.sourceType, slot.teamId ?? null,
          slot.sourceBracketMatchId ?? null, slot.seed ?? null,
          writeEngineJson(slot.metadata ?? {})
        ]);
      }
    }
    const nodeById = new Map(nodes.map(({ node }) => [node.id, node]));
    for (const { node } of nodes) {
      if (node.match === undefined) continue;
      for (const slot of node.slots) {
        const sourceNode = slot.sourceBracketMatchId === undefined
          ? undefined
          : nodeById.get(slot.sourceBracketMatchId);
        const structuralWinner = sourceNode?.playable === false
          ? singleStructuralWinner(sourceNode)
          : undefined;
        const sourceMatchId = sourceNode?.match?.id;
        const sourceType = structuralWinner !== undefined
          ? "team"
          : slot.sourceType === "match_winner" ? "match_winner" : slot.sourceType;
        await executor.query(`
          INSERT INTO engine_match_slots (
            tournament_id, match_id, slot_number, source_type,
            team_id, source_match_id, seed, metadata
          ) VALUES (
            $1::uuid, $2::uuid, $3, $4,
            $5::uuid, $6::uuid, $7, $8::jsonb
          )
        `, [
          input.tournamentId, node.match.id, slot.slotNumber, sourceType,
          structuralWinner ?? slot.teamId ?? null,
          sourceType === "match_winner" ? sourceMatchId ?? null : null,
          slot.seed ?? null, writeEngineJson(slot.metadata ?? {})
        ]);
      }
    }
    for (const { node } of nodes.filter(({ node }) => isStructuralByeNode(node))) {
      const winnerTeamId = singleStructuralWinner(node);
      await this.persistBracketResolution(executor, {
        resolutionId: randomUUID(),
        tournamentId: input.tournamentId,
        bracketMatchId: node.id,
        winnerTeamId,
        resolutionType: "structural_bye",
        matchStatus: "bye",
        confirmationDigest: input.confirmationDigest,
        administratorId: input.administratorId,
        occurredAt: input.occurredAt
      });
    }
    await executor.query(`
      INSERT INTO engine_bracket_publications (
        id, tournament_id, bracket_id, seed_calculation_id,
        seed_override_command_id, cumulative_workbook_id,
        confirmation_digest, published_by_admin_id, published_at, metadata
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        $5::uuid, $6::uuid, $7, $8::uuid, $9, $10::jsonb
      )
    `, [
      input.publicationId, input.tournamentId, input.bracket.id,
      input.seedCalculationId, input.seedOverrideCommandId ?? null,
      input.cumulativeWorkbookId, input.confirmationDigest,
      input.administratorId, input.occurredAt,
      writeEngineJson(input.metadata ?? {})
    ]);
    await executor.query(`
      INSERT INTO engine_active_brackets (
        tournament_id, bracket_id, publication_id, activated_at
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
    `, [
      input.tournamentId, input.bracket.id,
      input.publicationId, input.occurredAt
    ]);
    const playoffRowVersion = await updateTournamentVersion(
      executor, input.tournamentId, input.expectedTournamentRowVersion,
      "playoffs", input.occurredAt
    );
    const finalNode = nodes.find(({ node }) => !nodes.some(({ node: candidate }) =>
      candidate.slots.some((slot) => slot.sourceBracketMatchId === node.id)
    ));
    const autoCompleted = finalNode !== undefined &&
      isStructuralByeNode(finalNode.node);
    if (autoCompleted) {
      await executor.query(`
        UPDATE engine_brackets SET status = 'completed'
        WHERE tournament_id = $1::uuid AND id = $2::uuid
      `, [input.tournamentId, input.bracket.id]);
    }
    const rowVersion = autoCompleted
      ? await updateTournamentVersion(
        executor, input.tournamentId, playoffRowVersion,
        "completed", input.occurredAt
      )
      : playoffRowVersion;
    await safeAudit(executor, {
      tournamentId: input.tournamentId,
      commandType: "bracket_published",
      actorId: input.administratorId,
      occurredAt: input.occurredAt,
      details: {
        bracketId: input.bracket.id,
        publicationId: input.publicationId,
        seedCalculationId: input.seedCalculationId,
        cumulativeWorkbookId: input.cumulativeWorkbookId,
        confirmationDigest: input.confirmationDigest
      }
    });
    return {
      tournamentId: input.tournamentId,
      bracketId: input.bracket.id,
      publicationId: input.publicationId,
      lifecycle: autoCompleted ? "completed" : "playoffs",
      tournamentRowVersion: rowVersion,
      playableMatchIds: nodes.flatMap(({ node }) =>
        node.match === undefined ? [] : [node.match.id]
      )
    };
  }

  async resolveBracketMatchInTransaction(
    input: ResolveBracketMatchInput,
    transaction: TransactionContext
  ): Promise<ResolveBracketMatchResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const tournament = await this.lockTournament(executor, input.tournamentId);
    assertTournamentVersion(tournament, input.expectedTournamentRowVersion);
    if (!["playoffs", "completed"].includes(tournament.lifecycle)) {
      invariant("Bracket matches may resolve only during playoffs.");
    }
    let expectedTournamentRowVersion = input.expectedTournamentRowVersion;
    if (tournament.lifecycle === "completed") {
      await executor.query(`
        UPDATE engine_brackets bracket SET status = 'published'
        FROM engine_active_brackets active
        WHERE active.tournament_id = $1::uuid
          AND active.bracket_id = bracket.id
          AND bracket.status = 'completed'
      `, [input.tournamentId]);
      expectedTournamentRowVersion = await updateTournamentVersion(
        executor, input.tournamentId, expectedTournamentRowVersion,
        "playoffs", input.occurredAt
      );
    }
    const node = (await executor.query<{
      bracket_id: string;
      match_id: string | null;
      playable: boolean;
      active_revision_id: string | null;
      status: string | null;
    }>(`
      SELECT bracket_match.bracket_id::text, bracket_match.match_id::text,
             bracket_match.playable, match.active_revision_id::text,
             match.status
      FROM engine_active_brackets active
      JOIN engine_bracket_matches bracket_match
        ON bracket_match.bracket_id = active.bracket_id
       AND bracket_match.id = $2::uuid
      LEFT JOIN engine_matches match ON match.id = bracket_match.match_id
      WHERE active.tournament_id = $1::uuid
      FOR UPDATE OF bracket_match
    `, [input.tournamentId, input.bracketMatchId])).rows[0];
    if (node === undefined) invariant("Active bracket match was not found.");
    if (input.resolutionType === "match_result") {
      if (
        !node.playable || node.match_id !== input.matchId ||
        node.active_revision_id !== input.revisionId ||
        node.status !== input.matchStatus ||
        !["final", "forfeited"].includes(input.matchStatus)
      ) {
        conflict("The playoff result changed after advancement was prepared.");
      }
      const winningTeam = await executor.query(`
        SELECT 1 FROM engine_match_revision_teams
        WHERE tournament_id = $1::uuid AND revision_id = $2::uuid
          AND team_id = $3::uuid AND result = 'win'
      `, [input.tournamentId, input.revisionId, input.winnerTeamId]);
      if (winningTeam.rows[0] === undefined) {
        invariant("Bracket winner must be the winning team in the active revision.");
      }
    } else if (node.playable || node.match_id !== null) {
      invariant("Only a structural bye node may resolve automatically.");
    }
    const prior = (await executor.query<{
      resolution_id: string;
      winner_team_id: string;
    }>(`
      SELECT active.resolution_id::text, resolution.winner_team_id::text
      FROM engine_active_bracket_match_resolutions active
      JOIN engine_bracket_match_resolutions resolution
        ON resolution.id = active.resolution_id
      WHERE active.tournament_id = $1::uuid
        AND active.bracket_match_id = $2::uuid
      FOR UPDATE OF active
    `, [input.tournamentId, input.bracketMatchId])).rows[0];
    if (
      prior !== undefined && prior.winner_team_id !== input.winnerTeamId &&
      await dependentMatchStarted(executor, input.bracketMatchId)
    ) {
      invariant(
        "Winner correction affects a started dependent match; a confirmed replacement cascade is required."
      );
    }
    const advancedToBracketMatchId = await this.persistBracketResolution(
      executor, input
    );
    const finalNode = (await executor.query<{ final: boolean }>(`
      SELECT NOT EXISTS (
        SELECT 1 FROM engine_bracket_slots slot
        WHERE slot.source_bracket_match_id = $1::uuid
      ) AS final
    `, [input.bracketMatchId])).rows[0]?.final === true;
    if (finalNode) {
      await executor.query(`
        UPDATE engine_brackets SET status = 'completed'
        WHERE id = $1::uuid AND status = 'published'
      `, [node.bracket_id]);
    }
    const lifecycle = finalNode ? "completed" as const : "playoffs" as const;
    const rowVersion = await updateTournamentVersion(
      executor, input.tournamentId, expectedTournamentRowVersion,
      lifecycle, input.occurredAt
    );
    await safeAudit(executor, {
      tournamentId: input.tournamentId,
      matchId: input.matchId,
      commandType: "bracket_match_resolved",
      actorId: input.administratorId,
      occurredAt: input.occurredAt,
      details: {
        bracketMatchId: input.bracketMatchId,
        resolutionId: input.resolutionId,
        winnerTeamId: input.winnerTeamId,
        confirmationDigest: input.confirmationDigest,
        ...(advancedToBracketMatchId === undefined
          ? {}
          : { advancedToBracketMatchId })
      }
    });
    return {
      tournamentId: input.tournamentId,
      bracketMatchId: input.bracketMatchId,
      resolutionId: input.resolutionId,
      ...(advancedToBracketMatchId === undefined
        ? {}
        : { advancedToBracketMatchId }),
      tournamentCompleted: finalNode,
      tournamentRowVersion: rowVersion
    };
  }

  async replaceStartedDependentMatchInTransaction(
    input: ReplaceStartedDependentMatchInput,
    transaction: TransactionContext
  ): Promise<ReplaceStartedDependentMatchResult> {
    const sourceActivation = input.correctedSource.activation;
    const correctedWinnerTeamId = input.correctedSource.winnerTeamId;
    const activationWinnerTeamId = sourceActivation.teams.find(
      (team) => team.result === "win"
    )?.teamId;
    const validCorrectedResult = correctedWinnerTeamId === undefined
      ? sourceActivation.revision.status === input.correctedSource.matchStatus &&
        activationWinnerTeamId === undefined
      : ["final", "forfeited"].includes(sourceActivation.revision.status) &&
        activationWinnerTeamId === correctedWinnerTeamId;
    if (sourceActivation.tournamentId !== input.tournamentId ||
        !validCorrectedResult) {
      conflict("The corrected source result changed after cascade preview.");
    }
    const activation = await this.revisionRepository.activateRevisionInTransaction(
      sourceActivation, transaction
    );
    const statistics = await this.statisticRepository.refreshActiveRevisionsInTransaction({
      tournamentId: input.tournamentId,
      rulesVersion: input.correctedSource.rulesVersion,
      calculatedAt: input.occurredAt,
      revisions: [{
        matchId: sourceActivation.matchId,
        revisionId: sourceActivation.revision.id
      }]
    }, transaction);
    const cascade = await this.replaceStartedDependentsForActiveCorrectionInTransaction({
      tournamentId: input.tournamentId,
      expectedTournamentRowVersion: input.expectedTournamentRowVersion,
      previousResolutionId: input.previousResolutionId,
      confirmationDigest: input.confirmationDigest,
      administratorId: input.administratorId,
      occurredAt: input.occurredAt,
      correctedSource: correctedWinnerTeamId === undefined ? {
        bracketMatchId: input.correctedSource.bracketMatchId,
        matchId: sourceActivation.matchId,
        revisionId: sourceActivation.revision.id,
        matchStatus: input.correctedSource.matchStatus
      } : {
        resolutionId: input.correctedSource.resolutionId,
        advancementId: input.correctedSource.advancementId,
        bracketMatchId: input.correctedSource.bracketMatchId,
        matchId: sourceActivation.matchId,
        revisionId: sourceActivation.revision.id,
        winnerTeamId: correctedWinnerTeamId,
        matchStatus: sourceActivation.revision.status as "final" | "forfeited"
      },
      replacements: input.replacements
    }, transaction);
    return {
      sourceActivation: activation,
      statistics,
      ...cascade
    };
  }

  async replaceStartedDependentsForActiveCorrectionInTransaction(
    input: ReplaceStartedDependentsForActiveCorrectionInput,
    transaction: TransactionContext
  ): Promise<ReplaceStartedDependentsForActiveCorrectionResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const tournament = await this.lockTournament(executor, input.tournamentId);
    assertTournamentVersion(tournament, input.expectedTournamentRowVersion);
    if (!["playoffs", "completed"].includes(tournament.lifecycle)) {
      invariant("Dependent playoff matches may be replaced only during playoffs.");
    }
    let expectedTournamentRowVersion = input.expectedTournamentRowVersion;
    if (tournament.lifecycle === "completed") {
      await executor.query(`
        UPDATE engine_brackets bracket SET status = 'published'
        FROM engine_active_brackets active
        WHERE active.tournament_id = $1::uuid
          AND active.bracket_id = bracket.id
          AND bracket.status = 'completed'
      `, [input.tournamentId]);
      expectedTournamentRowVersion = await updateTournamentVersion(
        executor, input.tournamentId, expectedTournamentRowVersion,
        "playoffs", input.occurredAt
      );
    }
    requireDigest(input.confirmationDigest);
    if (input.replacements.length === 0) {
      invariant("A replacement cascade must contain at least one match.");
    }
    const replacementBracketMatchIds = new Set(
      input.replacements.map((replacement) => replacement.bracketMatchId)
    );
    const source = (await executor.query<{
      resolution_id: string;
      match_id: string | null;
      active_revision_id: string | null;
      status: string | null;
      winner_team_id: string | null;
      prior_winner_team_id: string;
      destination_bracket_match_id: string | null;
      destination_slot_number: 1 | 2 | null;
      destination_match_id: string | null;
      destination_participants_frozen_at: Date | string | null;
    }>(`
      SELECT active.resolution_id::text, node.match_id::text,
             match.active_revision_id::text, match.status,
             revision_team.team_id::text AS winner_team_id,
             prior_resolution.winner_team_id::text AS prior_winner_team_id,
             advancement.destination_bracket_match_id::text,
             advancement.destination_slot_number,
             destination.match_id::text AS destination_match_id,
             destination_match.participants_frozen_at
               AS destination_participants_frozen_at
      FROM engine_bracket_matches node
      JOIN engine_active_bracket_match_resolutions active
        ON active.bracket_match_id = node.id
      JOIN engine_bracket_match_resolutions prior_resolution
        ON prior_resolution.id = active.resolution_id
      JOIN engine_matches match ON match.id = node.match_id
      LEFT JOIN engine_match_revision_teams revision_team
        ON revision_team.revision_id = match.active_revision_id
       AND revision_team.result = 'win'
      LEFT JOIN engine_bracket_advancements advancement
        ON advancement.source_resolution_id = active.resolution_id
      LEFT JOIN engine_bracket_matches destination
        ON destination.id = advancement.destination_bracket_match_id
      LEFT JOIN engine_matches destination_match
        ON destination_match.id = destination.match_id
      WHERE node.tournament_id = $1::uuid AND node.id = $2::uuid
      FOR UPDATE OF node, active, match
    `, [input.tournamentId, input.correctedSource.bracketMatchId])).rows[0];
    if (
      source?.resolution_id !== input.previousResolutionId ||
      source.match_id !== input.correctedSource.matchId ||
      source.active_revision_id !== input.correctedSource.revisionId ||
      source.status !== input.correctedSource.matchStatus ||
      source.winner_team_id !== (input.correctedSource.winnerTeamId ?? null)
    ) {
      conflict("The corrected active result changed after cascade preview.");
    }
    const correctedWinnerTeamId = input.correctedSource.winnerTeamId;
    const replacementSourceResolutionId = correctedWinnerTeamId === undefined
      ? input.previousResolutionId
      : input.correctedSource.resolutionId;
    if (correctedWinnerTeamId === undefined) {
      const destinationIsFrozen =
        source.destination_participants_frozen_at !== null;
      const destinationIsPlanned = source.destination_bracket_match_id !== null &&
        replacementBracketMatchIds.has(parseStableUuid(
          source.destination_bracket_match_id, "bracket_match"
        ));
      if (destinationIsFrozen && !destinationIsPlanned) {
        conflict("Replacement cascade omitted a started dependent match.");
      }
      await executor.query(`
        INSERT INTO engine_bracket_resolution_invalidations (
          id, tournament_id, bracket_match_id, resolution_id,
          correction_revision_id, destination_bracket_match_id,
          affected_match_id, confirmation_digest, reason,
          invalidated_by_admin_id, invalidated_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid,
          $5::uuid, $6::uuid, $7::uuid, $8, $9, $10::uuid, $11
        )
      `, [
        randomUUID(), input.tournamentId, input.correctedSource.bracketMatchId,
        source.resolution_id, input.correctedSource.revisionId,
        source.destination_bracket_match_id, source.destination_match_id,
        input.confirmationDigest,
        "Corrected result no longer has a bracket winner.",
        input.administratorId, input.occurredAt
      ]);
      await executor.query(`
        DELETE FROM engine_active_bracket_match_resolutions
        WHERE tournament_id = $1::uuid AND bracket_match_id = $2::uuid
          AND resolution_id = $3::uuid
      `, [
        input.tournamentId, input.correctedSource.bracketMatchId,
        source.resolution_id
      ]);
      if (source.destination_bracket_match_id !== null &&
          source.destination_slot_number !== null) {
        await executor.query(`
          UPDATE engine_bracket_slots SET team_id = NULL
          WHERE tournament_id = $1::uuid AND bracket_match_id = $2::uuid
            AND slot_number = $3 AND team_id = $4::uuid
        `, [
          input.tournamentId, source.destination_bracket_match_id,
          source.destination_slot_number, source.prior_winner_team_id
        ]);
        if (source.destination_match_id !== null && !destinationIsFrozen) {
          await executor.query(`
            UPDATE engine_match_slots
            SET source_type = 'match_winner', team_id = NULL,
                source_match_id = $4::uuid
            WHERE tournament_id = $1::uuid AND match_id = $2::uuid
              AND slot_number = $3
          `, [
            input.tournamentId, source.destination_match_id,
            source.destination_slot_number, input.correctedSource.matchId
          ]);
          await executor.query(`
            UPDATE engine_bracket_matches SET playable = false
            WHERE tournament_id = $1::uuid AND id = $2::uuid
              AND match_id = $3::uuid
          `, [
            input.tournamentId, source.destination_bracket_match_id,
            source.destination_match_id
          ]);
        }
      }
    } else {
      await this.persistBracketResolution(executor, {
        ...input.correctedSource,
        tournamentId: input.tournamentId,
        resolutionType: "match_result",
        confirmationDigest: input.confirmationDigest,
        administratorId: input.administratorId,
        occurredAt: input.occurredAt,
        allowFrozenDestination: true
      });
    }
    for (const replacement of input.replacements) {
      await lockEngineMatch(executor, replacement.previousMatchId);
      const current = (await executor.query<{
        match_id: string | null;
        participants_frozen_at: Date | string | null;
      }>(`
        SELECT bracket_match.match_id::text, match.participants_frozen_at
        FROM engine_bracket_matches bracket_match
        JOIN engine_matches match ON match.id = bracket_match.match_id
        WHERE bracket_match.tournament_id = $1::uuid
          AND bracket_match.id = $2::uuid
        FOR UPDATE OF bracket_match, match
      `, [input.tournamentId, replacement.bracketMatchId])).rows[0];
      if (
        current?.match_id !== replacement.previousMatchId ||
        current.participants_frozen_at === null
      ) {
        conflict("Replacement cascade no longer targets the active started match.");
      }
      const priorResolution = (await executor.query<{
        resolution_id: string;
        winner_team_id: string;
        destination_bracket_match_id: string | null;
        destination_slot_number: 1 | 2 | null;
        destination_match_id: string | null;
        destination_participants_frozen_at: Date | string | null;
      }>(`
        SELECT active.resolution_id::text, resolution.winner_team_id::text,
               advancement.destination_bracket_match_id::text,
               advancement.destination_slot_number,
               destination.match_id::text AS destination_match_id,
               destination_match.participants_frozen_at
                 AS destination_participants_frozen_at
        FROM engine_active_bracket_match_resolutions active
        JOIN engine_bracket_match_resolutions resolution
          ON resolution.id = active.resolution_id
        LEFT JOIN engine_bracket_advancements advancement
          ON advancement.source_resolution_id = active.resolution_id
        LEFT JOIN engine_bracket_matches destination
          ON destination.id = advancement.destination_bracket_match_id
        LEFT JOIN engine_matches destination_match
          ON destination_match.id = destination.match_id
        WHERE active.tournament_id = $1::uuid
          AND active.bracket_match_id = $2::uuid
        FOR UPDATE OF active
      `, [input.tournamentId, replacement.bracketMatchId])).rows[0];
      if (priorResolution !== undefined) {
        const destinationIsFrozen =
          priorResolution.destination_participants_frozen_at !== null;
        const destinationIsPlanned =
          priorResolution.destination_bracket_match_id !== null &&
          replacementBracketMatchIds.has(parseStableUuid(
            priorResolution.destination_bracket_match_id, "bracket_match"
          ));
        if (destinationIsFrozen && !destinationIsPlanned) {
          conflict(
            "Replacement cascade omitted a started dependent match."
          );
        }
        await executor.query(`
          INSERT INTO engine_bracket_resolution_invalidations (
            id, tournament_id, bracket_match_id, resolution_id,
            correction_revision_id, destination_bracket_match_id,
            affected_match_id, confirmation_digest, reason,
            invalidated_by_admin_id, invalidated_at
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4::uuid,
            $5::uuid, $6::uuid, $7::uuid, $8, $9, $10::uuid, $11
          )
        `, [
          randomUUID(), input.tournamentId, replacement.bracketMatchId,
          priorResolution.resolution_id, input.correctedSource.revisionId,
          priorResolution.destination_bracket_match_id,
          priorResolution.destination_match_id, input.confirmationDigest,
          replacement.reason, input.administratorId, input.occurredAt
        ]);
        await executor.query(`
          DELETE FROM engine_active_bracket_match_resolutions
          WHERE tournament_id = $1::uuid AND bracket_match_id = $2::uuid
            AND resolution_id = $3::uuid
        `, [
          input.tournamentId, replacement.bracketMatchId,
          priorResolution.resolution_id
        ]);
        if (
          priorResolution.destination_bracket_match_id !== null &&
          priorResolution.destination_slot_number !== null
        ) {
          await executor.query(`
            UPDATE engine_bracket_slots SET team_id = NULL
            WHERE tournament_id = $1::uuid AND bracket_match_id = $2::uuid
              AND slot_number = $3 AND team_id = $4::uuid
          `, [
            input.tournamentId,
            priorResolution.destination_bracket_match_id,
            priorResolution.destination_slot_number,
            priorResolution.winner_team_id
          ]);
        }
      }
      const replacementMatch = replacement.createWhenPlayable === true
        ? replacement.pendingMatch
        : replacement.match;
      if (replacement.createWhenPlayable === true) {
        await this.reservePlayoffMatchIdentity(
          executor, input.tournamentId, replacement.pendingMatch, input.occurredAt
        );
      } else {
        await this.insertPlayoffMatch(
          executor, input.tournamentId, replacement.match, input.occurredAt
        );
        for (const slot of replacement.match.slots) {
          const sourceMatchId = slot.sourceBracketMatchId === undefined
            ? null
            : (await executor.query<{ match_id: string | null }>(`
              SELECT match_id::text FROM engine_bracket_matches
              WHERE id = $1::uuid AND tournament_id = $2::uuid
            `, [slot.sourceBracketMatchId, input.tournamentId])).rows[0]?.match_id ?? null;
          await executor.query(`
            INSERT INTO engine_match_slots (
              tournament_id, match_id, slot_number, source_type,
              team_id, source_match_id, seed, metadata
            ) VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::uuid, $7, $8::jsonb)
          `, [
            input.tournamentId, replacement.match.id, slot.slotNumber,
            slot.sourceType, slot.teamId ?? null, sourceMatchId,
            slot.seed ?? null, writeEngineJson(slot.metadata ?? {})
          ]);
        }
      }
      await executor.query(`
        INSERT INTO engine_bracket_match_replacements (
          id, tournament_id, bracket_match_id, previous_match_id,
          replacement_match_id, replacement_sequence, create_when_playable,
          source_resolution_id, confirmation_digest, reason,
          replaced_by_admin_id, replaced_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid,
          $5::uuid, $6, $7, $8::uuid, $9, $10, $11::uuid, $12
        )
      `, [
        replacement.replacementId, input.tournamentId,
        replacement.bracketMatchId, replacement.previousMatchId,
        replacementMatch.id, replacementMatch.sequence,
        replacement.createWhenPlayable === true,
        replacementSourceResolutionId, input.confirmationDigest,
        replacement.reason, input.administratorId, input.occurredAt
      ]);
      if (
        priorResolution?.destination_bracket_match_id !== null &&
        priorResolution?.destination_bracket_match_id !== undefined &&
        priorResolution.destination_slot_number !== null &&
        priorResolution.destination_match_id !== null &&
        priorResolution.destination_participants_frozen_at === null &&
        !replacementBracketMatchIds.has(parseStableUuid(
          priorResolution.destination_bracket_match_id, "bracket_match"
        ))
      ) {
        await executor.query(`
          UPDATE engine_match_slots
          SET source_type = 'match_winner', team_id = NULL,
              source_match_id = $4::uuid
          WHERE tournament_id = $1::uuid AND match_id = $2::uuid
            AND slot_number = $3
        `, [
          input.tournamentId, priorResolution.destination_match_id,
          priorResolution.destination_slot_number, replacementMatch.id
        ]);
        await executor.query(`
          UPDATE engine_bracket_matches SET playable = false
          WHERE tournament_id = $1::uuid AND id = $2::uuid
            AND match_id = $3::uuid
        `, [
          input.tournamentId,
          priorResolution.destination_bracket_match_id,
          priorResolution.destination_match_id
        ]);
      }
      if (replacement.createWhenPlayable === true) {
        await executor.query(`
          UPDATE engine_bracket_matches SET match_id = NULL, playable = false
          WHERE tournament_id = $1::uuid AND id = $2::uuid
            AND match_id = $3::uuid
        `, [
          input.tournamentId, replacement.bracketMatchId,
          replacement.previousMatchId
        ]);
        await executor.query(`
          UPDATE engine_bracket_slots SET team_id = NULL
          WHERE tournament_id = $1::uuid AND bracket_match_id = $2::uuid
            AND source_bracket_match_id = ANY($3::uuid[])
        `, [
          input.tournamentId, replacement.bracketMatchId,
          input.replacements.map((item) => item.bracketMatchId)
        ]);
      } else {
        await executor.query(`
          UPDATE engine_bracket_matches SET match_id = $3::uuid
          WHERE tournament_id = $1::uuid AND id = $2::uuid
        `, [
          input.tournamentId, replacement.bracketMatchId,
          replacement.match.id
        ]);
        for (const slot of replacement.match.slots) {
          await executor.query(`
            UPDATE engine_bracket_slots SET team_id = $4::uuid
            WHERE tournament_id = $1::uuid AND bracket_match_id = $2::uuid
              AND slot_number = $3
          `, [
            input.tournamentId, replacement.bracketMatchId,
            slot.slotNumber, slot.teamId ?? null
          ]);
        }
      }
    }
    const tournamentRowVersion = await updateTournamentVersion(
      executor, input.tournamentId, expectedTournamentRowVersion,
      "playoffs", input.occurredAt
    );
    await safeAudit(executor, {
      tournamentId: input.tournamentId,
      commandType: "playoff_match_replacement_cascade",
      actorId: input.administratorId,
      occurredAt: input.occurredAt,
      details: {
        previousResolutionId: input.previousResolutionId,
        correctedResolutionId: input.correctedSource.resolutionId ?? null,
        correctedMatchStatus: input.correctedSource.matchStatus,
        confirmationDigest: input.confirmationDigest,
        replacementIds: input.replacements.map((item) => item.replacementId)
      }
    });
    return {
      replacementMatchIds: input.replacements.map((item) =>
        item.createWhenPlayable === true ? item.pendingMatch.id : item.match.id
      ),
      tournamentRowVersion
    };
  }

  async previewOperatorMatchResolutionInTransaction(
    input: PreviewOperatorMatchResolutionInput,
    transaction: TransactionContext
  ): Promise<OperatorMatchResolutionPreview> {
    const executor = engineExecutor(this.database, transaction);
    const context = await readMatchContext(executor, input.tournamentId, input.matchId);
    if (
      Number(context.tournament_row_version) !== input.expectedTournamentRowVersion ||
      Number(context.match_row_version) !== input.expectedMatchRowVersion
    ) {
      conflict("Match or tournament changed after the operator command was prepared.");
    }
    validateOperatorCommand(input, context);
    const dependentRows = context.bracket_match_id === null
      ? []
      : (await executor.query<{
        bracket_match_id: string;
        participants_frozen_at: Date | string | null;
      }>(`
        WITH RECURSIVE descendants AS (
          SELECT destination.id, destination.match_id
          FROM engine_bracket_slots slot
          JOIN engine_bracket_matches destination
            ON destination.id = slot.bracket_match_id
          WHERE slot.source_bracket_match_id = $1::uuid
          UNION
          SELECT destination.id, destination.match_id
          FROM descendants prior
          JOIN engine_bracket_slots slot
            ON slot.source_bracket_match_id = prior.id
          JOIN engine_bracket_matches destination
            ON destination.id = slot.bracket_match_id
        )
        SELECT descendants.id::text AS bracket_match_id,
               match.participants_frozen_at
        FROM descendants
        LEFT JOIN engine_matches match ON match.id = descendants.match_id
        ORDER BY descendants.id
      `, [context.bracket_match_id])).rows;
    const proposedStatus = operatorStatus(input.commandType);
    const changesResolvedWinner = input.commandType !== "forfeit" ||
      input.winnerTeamId !== context.winner_team_id;
    const requiresCascade = changesResolvedWinner &&
      dependentRows.some((row) => row.participants_frozen_at !== null);
    const confirmationDigest = canonicalSha256({
      contract: "operator-match-resolution-preview-v1",
      tournamentId: input.tournamentId,
      tournamentRowVersion: input.expectedTournamentRowVersion,
      matchId: input.matchId,
      matchRowVersion: input.expectedMatchRowVersion,
      activeRevisionId: context.active_revision_id,
      currentStatus: context.status,
      currentWinnerTeamId: context.winner_team_id,
      proposedStatus,
      proposedWinnerTeamId: input.winnerTeamId ?? null,
      reason: input.reason,
      activeFinalizationId: context.active_finalization_id,
      bracketMatchId: context.bracket_match_id,
      dependentBracketMatchIds: dependentRows.map((row) => row.bracket_match_id),
      requiresCascade
    });
    return {
      tournamentId: input.tournamentId,
      matchId: input.matchId,
      currentStatus: context.status as OperatorMatchResolutionPreview["currentStatus"],
      proposedStatus,
      ...(input.winnerTeamId === undefined
        ? {}
        : { proposedWinnerTeamId: input.winnerTeamId }),
      ...(context.pod_id === null
        ? {}
        : { podId: parseStableUuid(context.pod_id, "pod") }),
      ...(context.active_finalization_id === null
        ? {}
        : { activeFinalizationId: context.active_finalization_id }),
      ...(context.bracket_match_id === null
        ? {}
        : { bracketMatchId: parseStableUuid(context.bracket_match_id, "bracket_match") }),
      dependentBracketMatchIds: dependentRows.map((row) =>
        parseStableUuid(row.bracket_match_id, "bracket_match")
      ),
      requiresCascade,
      confirmationDigest
    };
  }

  async recordOperatorMatchResolutionInTransaction(
    input: RecordOperatorMatchResolutionInput,
    transaction: TransactionContext,
    cascade?: Pick<
      RecordOperatorMatchResolutionWithCascadeInput,
      "previousResolutionId" | "correctedResolutionId" |
      "correctedAdvancementId" | "cascadeConfirmationDigest" | "replacements"
    >
  ): Promise<RecordOperatorMatchResolutionResult |
    RecordOperatorMatchResolutionWithCascadeResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    await lockEngineMatch(executor, input.matchId);
    const preview = await this.previewOperatorMatchResolutionInTransaction({
      tournamentId: input.tournamentId,
      matchId: input.matchId,
      expectedTournamentRowVersion: input.expectedTournamentRowVersion,
      expectedMatchRowVersion: input.expectedMatchRowVersion,
      commandType: input.commandType,
      ...(input.winnerTeamId === undefined ? {} : { winnerTeamId: input.winnerTeamId }),
      reason: input.reason
    }, transaction);
    if (preview.confirmationDigest !== input.confirmationDigest) {
      conflict("Operator resolution confirmation no longer matches current state.");
    }
    if (cascade !== undefined) requireDigest(cascade.cascadeConfirmationDigest);
    if (cascade !== undefined && (
      preview.bracketMatchId === undefined || !preview.requiresCascade
    )) {
      invariant("Operator cascade requires a confirmed playoff result change.");
    }
    if (cascade !== undefined && input.winnerTeamId !== undefined && (
      cascade.correctedResolutionId === undefined ||
      cascade.correctedAdvancementId === undefined
    )) {
      invariant("Winner cascades require corrected resolution identities.");
    }
    if (cascade !== undefined && input.winnerTeamId === undefined &&
        (cascade.correctedResolutionId !== undefined ||
         cascade.correctedAdvancementId !== undefined)) {
      invariant("No-winner cascades forbid corrected resolution identities.");
    }
    const holderId = `operator:${input.commandId}`;
    const lease = await this.writerRepository.acquireInTransaction({
      tournamentId: input.tournamentId,
      matchId: input.matchId,
      mode: "operator_correction",
      holderId,
      acquiredAt: input.occurredAt,
      expiresAt: input.writerLeaseExpiresAt
    }, transaction);
    if (!lease.acquired) {
      throw new EngineWriterLeaseConflictError(
        "Another scoring writer is active for this match."
      );
    }
    const context = await readMatchContext(executor, input.tournamentId, input.matchId);
    const participants = await authoritativeMatchParticipants(
      executor, input.tournamentId, input.matchId, context.active_revision_id
    );
    const revisionNumber = context.active_revision_id === null
      ? 1
      : Number((await executor.query<{ revision_number: number }>(`
        SELECT revision_number FROM engine_match_revisions
        WHERE id = $1::uuid
      `, [context.active_revision_id])).rows[0]?.revision_number ?? 0) + 1;
    const status = operatorStatus(input.commandType);
    const teams = operatorTeams(participants, input.commandType, input.winnerTeamId);
    const eventTeamId = input.commandType === "forfeit"
      ? teams.find((team) => team.result === "forfeited")?.teamId
      : undefined;
    const activationInput: ActivateMatchRevisionInput = {
      tournamentId: input.tournamentId,
      matchId: input.matchId,
      expectedMatchRowVersion: input.expectedMatchRowVersion,
      revision: {
        id: input.revisionId,
        publicKey: input.revisionPublicKey,
        revisionNumber,
        ...(context.active_revision_id === null ? {} : {
          previousRevisionId: parseStableUuid(
            context.active_revision_id, "match_revision"
          )
        }),
        status,
        scoreAvailability: input.commandType !== "postpone"
          ? "not_applicable"
          : "not_started",
        reason: "operator_resolution",
        sourceAdapter: "operator_correction",
        actorId: input.actorId,
        correctionReason: input.reason,
        confirmationDigest: input.confirmationDigest,
        createdAt: input.occurredAt,
        metadata: { operatorCommandId: input.commandId }
      },
      teams,
      events: [{
        id: parseStableUuid(input.eventId, "scoring_event"),
        sequence: 1,
        type: input.commandType === "forfeit"
          ? "forfeit"
          : input.commandType === "cancel" ? "cancellation" : "postponement",
        ...(eventTeamId === undefined ? {} : { teamId: eventTeamId }),
        occurredAt: input.occurredAt,
        metadata: { operatorCommandId: input.commandId }
      }],
      writerFence: {
        mode: "operator_correction",
        holderId,
        fencingToken: lease.fencingToken,
        checkedAt: input.occurredAt
      },
      audit: {
        eventId: randomUUID(),
        commandType: `operator_match_${input.commandType}`,
        actor: { kind: "administrator", id: input.actorId },
        occurredAt: input.occurredAt,
        details: {
          commandId: input.commandId,
          matchId: input.matchId,
          revisionId: input.revisionId,
          confirmationDigest: input.confirmationDigest,
          ...(cascade === undefined ? {} : {
            cascadeConfirmationDigest: cascade.cascadeConfirmationDigest
          })
        }
      }
    };
    const activation = await this.revisionRepository.activateRevisionInTransaction(
      activationInput, transaction
    );
    const statistics = await this.statisticRepository.refreshActiveRevisionsInTransaction({
      tournamentId: input.tournamentId,
      rulesVersion: input.rulesVersion,
      calculatedAt: input.occurredAt,
      revisions: [{ matchId: input.matchId, revisionId: input.revisionId }]
    }, transaction);
    let replacementMatchIds: readonly MatchId[] | undefined;
    const progression = cascade === undefined
      ? await this.refreshProgressionAfterRevisionInTransaction({
        tournamentId: input.tournamentId,
        matchId: input.matchId,
        revisionId: input.revisionId,
        confirmationDigest: input.confirmationDigest,
        actorId: input.actorId,
        occurredAt: input.occurredAt
      }, transaction)
      : await (async (): Promise<RefreshProgressionAfterRevisionResult> => {
        if (preview.bracketMatchId === undefined) {
          invariant("Validated operator cascade lost its bracket source.");
        }
        const correctedSource = input.winnerTeamId === undefined ? {
          bracketMatchId: preview.bracketMatchId,
          matchId: input.matchId,
          revisionId: input.revisionId,
          matchStatus: status as "cancelled" | "postponed"
        } : {
          resolutionId: cascade.correctedResolutionId as string,
          advancementId: cascade.correctedAdvancementId as string,
          bracketMatchId: preview.bracketMatchId,
          matchId: input.matchId,
          revisionId: input.revisionId,
          winnerTeamId: input.winnerTeamId,
          matchStatus: "forfeited" as const
        };
        const result = await this.replaceStartedDependentsForActiveCorrectionInTransaction({
          tournamentId: input.tournamentId,
          expectedTournamentRowVersion: input.expectedTournamentRowVersion,
          previousResolutionId: cascade.previousResolutionId,
          correctedSource,
          replacements: cascade.replacements,
          confirmationDigest: cascade.cascadeConfirmationDigest,
          administratorId: input.actorId,
          occurredAt: input.occurredAt
        }, transaction);
        replacementMatchIds = result.replacementMatchIds;
        return {
          stage: "playoffs",
          ...(cascade.correctedResolutionId === undefined ? {} : {
            bracketResolutionId: cascade.correctedResolutionId
          }),
          tournamentCompleted: false,
          tournamentRowVersion: result.tournamentRowVersion
        };
      })();
    await executor.query(`
      INSERT INTO engine_operator_match_commands (
        id, tournament_id, match_id, revision_id, status,
        confirmation_digest, cascade_confirmation_digest,
        administrator_id, occurred_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7,
        $8::uuid, $9
      )
    `, [
      input.commandId, input.tournamentId, input.matchId,
      input.revisionId, status, input.confirmationDigest,
      cascade?.cascadeConfirmationDigest ?? null,
      input.actorId, input.occurredAt
    ]);
    await this.writerRepository.releaseInTransaction({
      tournamentId: input.tournamentId,
      matchId: input.matchId,
      holderId,
      fencingToken: lease.fencingToken,
      releasedAt: input.occurredAt
    }, transaction);
    return {
      activation,
      statistics,
      progression,
      ...(replacementMatchIds === undefined ? {} : { replacementMatchIds })
    };
  }

  async refreshProgressionAfterRevisionInTransaction(
    input: RefreshProgressionAfterRevisionInput,
    transaction: TransactionContext
  ): Promise<RefreshProgressionAfterRevisionResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    await lockEngineMatch(executor, input.matchId);
    const context = await readMatchContext(executor, input.tournamentId, input.matchId);
    if (context.active_revision_id !== input.revisionId) {
      conflict("Only an active match revision may refresh progression.");
    }
    requireDigest(input.confirmationDigest);
    if (context.stage === "pod_play") {
      if (context.pod_id === null) invariant("Pod match is missing its pod identity.");
      const podId = parseStableUuid(context.pod_id, "pod");
      const source = await this.authoritativePodStandingInput(
        executor, input.tournamentId, podId
      );
      const calculation = calculatePodStandings(source);
      const active = (await executor.query<{
        calculation_id: string;
        input_digest: string;
      }>(`
        SELECT calculation.id::text AS calculation_id, calculation.input_digest
        FROM engine_active_pod_standing_calculations active
        JOIN engine_standing_calculations calculation
          ON calculation.id = active.calculation_id
        WHERE active.tournament_id = $1::uuid AND active.pod_id = $2::uuid
      `, [input.tournamentId, podId])).rows[0];
      if (active?.input_digest === calculation.inputDigest) {
        return {
          stage: "pod_play",
          podCalculationId: active.calculation_id,
          tournamentCompleted: false,
          tournamentRowVersion: Number(context.tournament_row_version)
        };
      }
      if (context.active_finalization_id !== null &&
          await hasActiveBracket(executor, input.tournamentId)) {
        invariant("A published bracket blocks implicit correction of finalized pod play.");
      }
      const calculationId = randomUUID();
      const activated = await this.activatePodStandingsInTransaction({
        tournamentId: input.tournamentId,
        podId,
        expectedTournamentRowVersion: Number(context.tournament_row_version),
        artifact: artifactFromCalculation(
          calculationId, source, calculation, input.occurredAt
        ),
        activatedAt: input.occurredAt
      }, transaction);
      if (context.active_finalization_id === null) {
        return {
          stage: "pod_play",
          podCalculationId: calculationId,
          tournamentCompleted: false,
          tournamentRowVersion: activated.tournamentRowVersion
        };
      }
      const invalidated = await this.invalidatePodFinalizationInTransaction({
        invalidationId: randomUUID(),
        tournamentId: input.tournamentId,
        podId,
        expectedTournamentRowVersion: activated.tournamentRowVersion,
        replacementCalculationId: calculationId,
        correctionMatchId: input.matchId,
        correctionRevisionId: input.revisionId,
        confirmationDigest: input.confirmationDigest,
        administratorId: input.actorId,
        occurredAt: input.occurredAt,
        reason: "Active match revision changed finalized pod standings."
      }, transaction);
      return {
        stage: "pod_play",
        podCalculationId: calculationId,
        invalidatedFinalizationId: context.active_finalization_id,
        tournamentCompleted: false,
        tournamentRowVersion: invalidated.tournamentRowVersion
      };
    }
    if (!["final", "forfeited"].includes(context.status)) {
      if (context.bracket_match_id === null) {
        invariant("Playoff match is not linked to the active bracket.");
      }
      const activeResolution = (await executor.query<{
        resolution_id: string;
        destination_bracket_match_id: string | null;
        destination_slot_number: 1 | 2 | null;
        destination_match_id: string | null;
        destination_participants_frozen_at: Date | string | null;
      }>(`
        SELECT active.resolution_id::text,
               advancement.destination_bracket_match_id::text,
               advancement.destination_slot_number,
               destination.match_id::text AS destination_match_id,
               destination_match.participants_frozen_at
                 AS destination_participants_frozen_at
        FROM engine_active_bracket_match_resolutions active
        LEFT JOIN engine_bracket_advancements advancement
          ON advancement.tournament_id = active.tournament_id
         AND advancement.source_resolution_id = active.resolution_id
        LEFT JOIN engine_bracket_matches destination
          ON destination.tournament_id = advancement.tournament_id
         AND destination.id = advancement.destination_bracket_match_id
        LEFT JOIN engine_matches destination_match
          ON destination_match.tournament_id = destination.tournament_id
         AND destination_match.id = destination.match_id
        WHERE active.tournament_id = $1::uuid
          AND active.bracket_match_id = $2::uuid
        FOR UPDATE OF active
      `, [input.tournamentId, context.bracket_match_id])).rows[0];
      if (activeResolution === undefined) {
        return {
          stage: "playoffs",
          tournamentCompleted: false,
          tournamentRowVersion: Number(context.tournament_row_version)
        };
      }
      let expectedTournamentRowVersion = Number(context.tournament_row_version);
      if (context.lifecycle === "completed") {
        await executor.query(`
          UPDATE engine_brackets bracket SET status = 'published'
          FROM engine_active_brackets active
          WHERE active.tournament_id = $1::uuid
            AND active.bracket_id = bracket.id
            AND bracket.status = 'completed'
        `, [input.tournamentId]);
        expectedTournamentRowVersion = await updateTournamentVersion(
          executor, input.tournamentId, expectedTournamentRowVersion,
          "playoffs", input.occurredAt
        );
      } else if (context.lifecycle !== "playoffs") {
        invariant("A bracket result correction is not allowed in this lifecycle.");
      }
      if (activeResolution.destination_participants_frozen_at !== null) {
        invariant(
          "The prior winner has a started downstream match; a confirmed replacement cascade is required."
        );
      }
      const invalidationId = randomUUID();
      await executor.query(`
        INSERT INTO engine_bracket_resolution_invalidations (
          id, tournament_id, bracket_match_id, resolution_id,
          correction_revision_id, destination_bracket_match_id,
          affected_match_id, confirmation_digest, reason,
          invalidated_by_admin_id, invalidated_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid,
          $5::uuid, $6::uuid, $7::uuid, $8, $9, $10::uuid, $11
        )
      `, [
        invalidationId, input.tournamentId, context.bracket_match_id,
        activeResolution.resolution_id, input.revisionId,
        activeResolution.destination_bracket_match_id,
        activeResolution.destination_match_id, input.confirmationDigest,
        "Active playoff revision no longer identifies a winner.",
        input.actorId, input.occurredAt
      ]);
      await executor.query(`
        DELETE FROM engine_active_bracket_match_resolutions
        WHERE tournament_id = $1::uuid AND bracket_match_id = $2::uuid
          AND resolution_id = $3::uuid
      `, [
        input.tournamentId, context.bracket_match_id,
        activeResolution.resolution_id
      ]);
      if (
        activeResolution.destination_bracket_match_id !== null &&
        activeResolution.destination_slot_number !== null
      ) {
        await executor.query(`
          UPDATE engine_bracket_slots SET team_id = NULL
          WHERE tournament_id = $1::uuid
            AND bracket_match_id = $2::uuid
            AND slot_number = $3
        `, [
          input.tournamentId,
          activeResolution.destination_bracket_match_id,
          activeResolution.destination_slot_number
        ]);
      }
      if (
        activeResolution.destination_bracket_match_id !== null &&
        activeResolution.destination_slot_number !== null &&
        activeResolution.destination_match_id !== null
      ) {
        await executor.query(`
          UPDATE engine_match_slots
          SET source_type = 'match_winner', team_id = NULL,
              source_match_id = $4::uuid, seed = NULL
          WHERE tournament_id = $1::uuid AND match_id = $2::uuid
            AND slot_number = $3
        `, [
          input.tournamentId, activeResolution.destination_match_id,
          activeResolution.destination_slot_number, input.matchId
        ]);
        await executor.query(`
          UPDATE engine_bracket_matches SET playable = false
          WHERE tournament_id = $1::uuid AND id = $2::uuid
            AND match_id = $3::uuid AND playable
        `, [
          input.tournamentId,
          activeResolution.destination_bracket_match_id,
          activeResolution.destination_match_id
        ]);
      }
      const rowVersion = await updateTournamentVersion(
        executor, input.tournamentId, expectedTournamentRowVersion,
        "playoffs", input.occurredAt
      );
      await safeAudit(executor, {
        tournamentId: input.tournamentId,
        matchId: input.matchId,
        commandType: "bracket_match_resolution_invalidated",
        actorId: input.actorId,
        occurredAt: input.occurredAt,
        details: {
          bracketMatchId: context.bracket_match_id,
          invalidationId,
          resolutionId: activeResolution.resolution_id,
          correctionRevisionId: input.revisionId,
          confirmationDigest: input.confirmationDigest
        }
      });
      return {
        stage: "playoffs",
        tournamentCompleted: false,
        tournamentRowVersion: rowVersion
      };
    }
    if (context.bracket_match_id === null) {
      invariant("Playoff match is not linked to the active bracket.");
    }
    const winner = (await executor.query<{ team_id: string }>(`
      SELECT team_id::text FROM engine_match_revision_teams
      WHERE tournament_id = $1::uuid AND revision_id = $2::uuid AND result = 'win'
    `, [input.tournamentId, input.revisionId])).rows[0]?.team_id;
    if (winner === undefined) {
      invariant("A final or forfeited playoff revision must identify one winner.");
    }
    const resolved = await this.resolveBracketMatchInTransaction({
      resolutionId: randomUUID(),
      advancementId: randomUUID(),
      tournamentId: input.tournamentId,
      expectedTournamentRowVersion: Number(context.tournament_row_version),
      bracketMatchId: parseStableUuid(context.bracket_match_id, "bracket_match"),
      matchId: input.matchId,
      revisionId: input.revisionId,
      winnerTeamId: parseStableUuid(winner, "tournament_team"),
      resolutionType: "match_result",
      matchStatus: context.status as "final" | "forfeited",
      confirmationDigest: input.confirmationDigest,
      administratorId: input.actorId,
      occurredAt: input.occurredAt
    }, transaction);
    return {
      stage: "playoffs",
      bracketResolutionId: resolved.resolutionId,
      tournamentCompleted: resolved.tournamentCompleted,
      tournamentRowVersion: resolved.tournamentRowVersion
    };
  }

  private async lockTournament(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId
  ): Promise<LockedTournamentRow> {
    const row = (await executor.query<LockedTournamentRow>(`
      SELECT tournament.lifecycle, tournament.row_version,
             configuration.qualifiers_per_pod, configuration.games_per_pair,
             configuration.bracket_size
      FROM engine_tournaments tournament
      JOIN engine_tournament_configurations configuration
        ON configuration.tournament_id = tournament.id
      WHERE tournament.id = $1::uuid
      FOR UPDATE OF tournament
    `, [tournamentId])).rows[0];
    if (row === undefined) invariant("Tournament progression record was not found.");
    return row;
  }

  private async persistPodStandingArtifact(
    executor: EnginePostgresExecutor,
    artifact: PodStandingArtifactInput
  ): Promise<void> {
    const existing = (await executor.query<{ id: string }>(`
      SELECT id::text FROM engine_standing_calculations
      WHERE tournament_id = $1::uuid AND pod_id = $2::uuid
        AND input_digest = $3 AND rules_version = $4
    `, [
      artifact.source.tournamentId, artifact.source.podId,
      artifact.calculation.inputDigest, artifact.calculation.rulesVersion
    ])).rows[0]?.id;
    if (existing !== undefined) {
      if (existing !== artifact.calculationId) {
        conflict("A standing calculation with this authoritative input already exists.");
      }
      return;
    }
    await executor.query(`
      INSERT INTO engine_standing_calculations (
        id, tournament_id, scope, pod_id, input_digest, rules_version,
        status, calculation_input, created_at, metadata
      ) VALUES (
        $1::uuid, $2::uuid, 'pod', $3::uuid, $4, $5,
        $6, $7::jsonb, $8, $9::jsonb
      )
    `, [
      artifact.calculationId, artifact.source.tournamentId,
      artifact.source.podId, artifact.calculation.inputDigest,
      artifact.calculation.rulesVersion, artifact.calculation.status,
      writeEngineJson(artifact.source), artifact.createdAt,
      writeEngineJson(artifact.metadata ?? {})
    ]);
    const identityByTeam = new Map(artifact.rows.map((row) => [row.teamId, row]));
    for (const row of artifact.calculation.rows) {
      const identity = identityByTeam.get(row.teamId);
      if (identity === undefined) invariant("Standing row identity is incomplete.");
      await executor.query(`
        INSERT INTO engine_standing_rows (
          id, tournament_id, calculation_id, team_id, public_key, rank,
          tie_group, wins, losses, cup_differential, makes, attempts,
          shooting_percentage, qualified, administrator_resolution, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6,
          $7, $8, $9, $10, $11, $12, $13, $14, $15, '{}'::jsonb
        )
      `, [
        identity.rowId, artifact.source.tournamentId, artifact.calculationId,
        row.teamId, identity.publicKey, row.rank, row.tieGroupId ?? null,
        row.wins, row.losses, row.cupDifferential, row.makes, row.attempts,
        row.shootingPercentage, row.qualified,
        row.administratorResolution === undefined
          ? null
          : writeEngineJson(row.administratorResolution)
      ]);
    }
    for (const match of artifact.calculation.matchInputs) {
      await executor.query(`
        INSERT INTO engine_standing_calculation_matches (
          tournament_id, calculation_id, match_id, revision_id,
          statistic_run_id, statistic_input_digest, status,
          score_availability, disposition, blocking_reason
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid,
          $5::uuid, $6, $7, $8, $9, $10
        )
      `, [
        artifact.source.tournamentId, artifact.calculationId, match.matchId,
        match.revisionId, match.statisticRunId, match.statisticInputDigest,
        match.status, match.scoreAvailability, match.disposition,
        match.blockingReason ?? null
      ]);
    }
  }

  private async persistPodResolution(
    executor: EnginePostgresExecutor,
    input: ActivatePodStandingsInput
  ): Promise<void> {
    const resolution = input.resolution;
    if (resolution === undefined) return;
    const resolvedRows = input.artifact.calculation.rows.filter((row) =>
      row.administratorResolution?.resolutionId === resolution.commandId
    );
    if (resolvedRows.length === 0) {
      invariant("A tie resolution command must resolve at least one exact tie group.");
    }
    await executor.query(`
      INSERT INTO engine_standing_resolution_commands (
        id, tournament_id, pod_id, source_calculation_id,
        resolved_calculation_id, confirmation_digest, reason,
        resolved_by_admin_id, resolved_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        $5::uuid, $6, $7, $8::uuid, $9
      )
    `, [
      resolution.commandId, input.tournamentId, input.podId,
      resolution.sourceCalculationId, input.artifact.calculationId,
      requireDigest(resolution.confirmationDigest), resolution.reason,
      resolution.administratorId, resolution.occurredAt
    ]);
    for (const row of resolvedRows) {
      if (row.tieGroupId === undefined || row.rank === null) {
        invariant("Resolved standing rows require a tie group and rank.");
      }
      await executor.query(`
        INSERT INTO engine_standing_resolution_rows (
          resolution_id, tournament_id, team_id, tie_group, resolved_rank
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
      `, [
        resolution.commandId, input.tournamentId, row.teamId,
        row.tieGroupId, row.rank
      ]);
    }
  }

  private async authoritativePodStandingInput(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    podId: PodId
  ): Promise<CalculatePodStandingsInput> {
    const configuration = (await executor.query<{
      qualifiers_per_pod: number;
      games_per_pair: number;
    }>(`
      SELECT qualifiers_per_pod, games_per_pair
      FROM engine_tournament_configurations WHERE tournament_id = $1::uuid
    `, [tournamentId])).rows[0];
    if (configuration === undefined) invariant("Tournament configuration is missing.");
    const teamRows = (await executor.query<{
      team_id: string;
      initial_seed: number;
    }>(`
      SELECT team_id::text, initial_seed FROM engine_pod_teams
      WHERE tournament_id = $1::uuid AND pod_id = $2::uuid
      ORDER BY initial_seed
    `, [tournamentId, podId])).rows;
    const matchRows = (await executor.query<{
      match_id: string;
      revision_id: string | null;
      statistic_run_id: string | null;
      statistic_input_digest: string | null;
      status: CalculatePodStandingsInput["matches"][number]["status"];
      score_availability: CalculatePodStandingsInput["matches"][number]["scoreAvailability"];
      side_number: 1 | 2;
      team_id: string;
      result: CalculatePodStandingsInput["matches"][number]["teams"][number]["result"] | null;
      score: number | null;
      makes: string | number | null;
      attempts: string | number | null;
      cups_scored: string | number | null;
      cups_against: string | number | null;
    }>(`
      SELECT match.id::text AS match_id, match.active_revision_id::text AS revision_id,
             match_run.statistic_run_id::text, run.input_digest AS statistic_input_digest,
             match.status, match.score_availability, slot.slot_number AS side_number,
             slot.team_id::text, revision_team.result, revision_team.score,
             max(value.value) FILTER (WHERE value.metric = 'makes') AS makes,
             max(value.value) FILTER (WHERE value.metric = 'attempts') AS attempts,
             max(value.value) FILTER (WHERE value.metric = 'cups_scored') AS cups_scored,
             max(value.value) FILTER (WHERE value.metric = 'cups_against') AS cups_against
      FROM engine_matches match
      JOIN engine_match_slots slot ON slot.match_id = match.id
      LEFT JOIN engine_match_revision_teams revision_team
        ON revision_team.revision_id = match.active_revision_id
       AND revision_team.team_id = slot.team_id
      LEFT JOIN LATERAL (
        SELECT scoped.*
        FROM engine_canonical_statistic_run_scopes scoped
        WHERE scoped.tournament_id = match.tournament_id
          AND scoped.match_id = match.id
          AND scoped.revision_id = match.active_revision_id
          AND scoped.run_kind = 'match_revision'
        ORDER BY scoped.run_order DESC
        LIMIT 1
      ) match_run ON true
      LEFT JOIN engine_statistic_runs run ON run.id = match_run.statistic_run_id
      LEFT JOIN engine_canonical_statistic_values value
        ON value.statistic_run_id = match_run.statistic_run_id
       AND value.scope = 'match' AND value.subject_type = 'team'
       AND value.subject_id = slot.team_id
      WHERE match.tournament_id = $1::uuid AND match.pod_id = $2::uuid
      GROUP BY match.id, match.active_revision_id, match_run.statistic_run_id,
               run.input_digest, slot.slot_number, slot.team_id,
               revision_team.result, revision_team.score
      ORDER BY match.sequence, slot.slot_number
    `, [tournamentId, podId])).rows;
    const grouped = new Map<string, typeof matchRows>();
    for (const row of matchRows) {
      grouped.set(row.match_id, [...(grouped.get(row.match_id) ?? []), row]);
    }
    return {
      tournamentId,
      podId,
      rulesVersion: POD_STANDINGS_RULES_VERSION,
      qualifiersPerPod: configuration.qualifiers_per_pod,
      gamesPerPair: configuration.games_per_pair,
      teams: teamRows.map((row) => ({
        teamId: parseStableUuid(row.team_id, "tournament_team"),
        initialSeed: row.initial_seed
      })),
      matches: [...grouped.values()].map((rows) => {
        const first = rows[0];
        if (first === undefined || rows.length !== 2) {
          invariant("Every pod match must have exactly two authoritative slots.");
        }
        return {
          matchId: parseStableUuid(first.match_id, "match"),
          ...(first.revision_id === null ? {} : {
            revisionId: parseStableUuid(first.revision_id, "match_revision")
          }),
          ...(first.statistic_run_id === null ? {} : {
            statisticRunId: first.statistic_run_id
          }),
          ...(first.statistic_input_digest === null ? {} : {
            statisticInputDigest: first.statistic_input_digest
          }),
          status: first.status,
          scoreAvailability: first.score_availability,
          teams: rows.map((row) => ({
            teamId: parseStableUuid(row.team_id, "tournament_team"),
            result: row.result ?? "pending",
            score: row.score,
            makes: Number(row.makes ?? 0),
            attempts: Number(row.attempts ?? 0),
            cupsScored: Number(row.cups_scored ?? 0),
            cupsAgainst: Number(row.cups_against ?? 0)
          })) as unknown as CalculatePodStandingsInput["matches"][number]["teams"]
        };
      })
    };
  }

  private async clearDerivedSeedState(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    podId: PodId
  ): Promise<void> {
    await executor.query(`
      UPDATE engine_pods SET active_finalization_id = NULL
      WHERE tournament_id = $1::uuid AND id = $2::uuid
    `, [tournamentId, podId]);
    await executor.query(
      "DELETE FROM engine_active_tournament_standing_calculations WHERE tournament_id = $1::uuid",
      [tournamentId]
    );
    await executor.query(
      "DELETE FROM engine_active_seed_override_commands WHERE tournament_id = $1::uuid",
      [tournamentId]
    );
    await executor.query(
      "DELETE FROM engine_active_seed_calculations WHERE tournament_id = $1::uuid",
      [tournamentId]
    );
    await executor.query(
      "DELETE FROM engine_active_global_seed_reviews WHERE tournament_id = $1::uuid",
      [tournamentId]
    );
    await executor.query(
      "DELETE FROM engine_effective_seeds WHERE tournament_id = $1::uuid",
      [tournamentId]
    );
  }

  private async createGlobalSeedReview(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    occurredAt: string,
    tournamentRowVersion: number
  ): Promise<GlobalSeedReviewResult> {
    const seedCalculationId = randomUUID();
    const reviewVersionId = randomUUID();
    const authoritative = await this.authoritativeGlobalQualifiers(executor, tournamentId);
    const source = {
      tournamentId,
      seedCalculationId,
      rulesVersion: GLOBAL_QUALIFIER_SEEDING_RULES_VERSION,
      ...authoritative
    };
    const calculation = calculateGlobalQualifierSeeds(source);
    await this.persistGlobalSeedReview(
      executor, reviewVersionId, source, calculation, occurredAt
    );
    await this.activateGlobalSeedReview(
      executor, tournamentId, reviewVersionId, seedCalculationId, occurredAt
    );
    const activeSeeds = calculation.status === "complete"
      ? await this.persistCompleteSeedCalculation(
        executor, tournamentId, calculation, occurredAt, tournamentRowVersion
      )
      : undefined;
    return {
      reviewVersionId,
      seedCalculationId,
      status: calculation.status,
      tournamentRowVersion,
      tieGroups: calculation.tieGroups.map((group) => ({
        tieGroupId: group.tieGroupId,
        teamIds: group.teamIds,
        resolved: group.resolved
      })),
      ...(activeSeeds === undefined ? {} : { activeSeeds })
    };
  }

  private async authoritativeGlobalQualifiers(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId
  ) {
    const rows = (await executor.query<{
      team_id: string;
      pod_id: string;
      rank: number;
      wins: number;
      losses: number;
      cup_differential: number;
      makes: number;
      attempts: number;
      shooting_percentage: string | number | null;
    }>(`
      SELECT row.team_id::text, pod.id::text AS pod_id, row.rank,
             row.wins, row.losses, row.cup_differential, row.makes, row.attempts,
             row.shooting_percentage
      FROM engine_pods pod
      JOIN engine_pod_finalizations finalization
        ON finalization.id = pod.active_finalization_id
      JOIN engine_standing_rows row
        ON row.calculation_id = finalization.calculation_id
      WHERE pod.tournament_id = $1::uuid AND row.qualified
      ORDER BY pod.sequence, row.rank
    `, [tournamentId])).rows;
    if (rows.length === 0) invariant("Finalized pods contain no qualifiers.");
    const qualifiersPerPod = Number((await executor.query<{
      qualifiers_per_pod: number;
    }>(`
      SELECT qualifiers_per_pod FROM engine_tournament_configurations
      WHERE tournament_id = $1::uuid
    `, [tournamentId])).rows[0]?.qualifiers_per_pod ?? 0);
    return {
      qualifiersPerPod,
      qualifiers: rows.map((row) => ({
        teamId: parseStableUuid(row.team_id, "tournament_team"),
        podId: parseStableUuid(row.pod_id, "pod"),
        podRank: row.rank,
        wins: row.wins,
        losses: row.losses,
        cupDifferential: row.cup_differential,
        makes: row.makes,
        attempts: row.attempts,
        shootingPercentage: row.shooting_percentage === null
          ? null
          : Number(row.shooting_percentage)
      }))
    };
  }

  private async persistGlobalSeedReview(
    executor: EnginePostgresExecutor,
    reviewVersionId: string,
    source: Parameters<typeof calculateGlobalQualifierSeeds>[0],
    calculation: GlobalQualifierSeedCalculation,
    occurredAt: string
  ): Promise<void> {
    await executor.query(`
      INSERT INTO engine_global_seed_review_versions (
        id, tournament_id, seed_calculation_id, rules_version,
        input_digest, status, calculation_input, tie_groups, created_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4,
        $5, $6, $7::jsonb, $8::jsonb, $9
      )
    `, [
      reviewVersionId, calculation.tournamentId,
      calculation.seedCalculationId, calculation.rulesVersion,
      calculation.inputDigest, calculation.status, writeEngineJson(source),
      writeEngineJson(calculation.tieGroups), occurredAt
    ]);
    for (const row of calculation.rows) {
      await executor.query(`
        INSERT INTO engine_global_seed_review_rows (
          review_version_id, tournament_id, team_id, pod_id, pod_rank,
          wins, losses, cup_differential, makes, attempts, shooting_percentage,
          calculated_seed, tie_group, administrator_resolution
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
          $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb
        )
      `, [
        reviewVersionId, calculation.tournamentId, row.teamId, row.podId,
        row.podRank, row.wins, row.losses, row.cupDifferential,
        row.makes, row.attempts, row.shootingPercentage,
        row.calculatedSeed, row.tieGroupId ?? null,
        row.administratorResolution === undefined
          ? null
          : writeEngineJson(row.administratorResolution)
      ]);
    }
  }

  private async activateGlobalSeedReview(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    reviewVersionId: string,
    seedCalculationId: string,
    occurredAt: string
  ): Promise<void> {
    await executor.query(`
      INSERT INTO engine_active_global_seed_reviews (
        tournament_id, review_version_id, seed_calculation_id, activated_at
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
      ON CONFLICT (tournament_id) DO UPDATE SET
        review_version_id = EXCLUDED.review_version_id,
        seed_calculation_id = EXCLUDED.seed_calculation_id,
        activated_at = EXCLUDED.activated_at
    `, [tournamentId, reviewVersionId, seedCalculationId, occurredAt]);
  }

  private async materializeCompleteSeedReview(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    seedCalculationId: string,
    calculation: GlobalQualifierSeedCalculation,
    occurredAt: string,
    expectedTournamentRowVersion: number,
    resolution: {
      readonly actorId: string;
      readonly tieGroupId: string;
      readonly sourceReviewVersionId: string;
      readonly resolvedReviewVersionId: string;
      readonly confirmationDigest: string;
    }
  ): Promise<ActiveSeedResult> {
    if (calculation.seedCalculationId !== seedCalculationId) {
      invariant("Resolved seed review changed its logical calculation identity.");
    }
    const result = await this.persistCompleteSeedCalculation(
      executor, tournamentId, calculation, occurredAt,
      expectedTournamentRowVersion + 1
    );
    const rowVersion = await updateTournamentVersion(
      executor, tournamentId, expectedTournamentRowVersion,
      "seeding_review", occurredAt
    );
    await safeAudit(executor, {
      tournamentId,
      commandType: "global_seed_tie_resolved",
      actorId: resolution.actorId,
      occurredAt,
      details: {
        seedCalculationId,
        status: calculation.status,
        tieGroupId: resolution.tieGroupId,
        sourceReviewVersionId: resolution.sourceReviewVersionId,
        resolvedReviewVersionId: resolution.resolvedReviewVersionId,
        confirmationDigest: resolution.confirmationDigest
      }
    });
    return { ...result, tournamentRowVersion: rowVersion };
  }

  private async persistCompleteSeedCalculation(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    calculation: GlobalQualifierSeedCalculation,
    occurredAt: string,
    tournamentRowVersion: number
  ): Promise<ActiveSeedResult> {
    const plan = createCalculatedEffectiveSeedPlan(calculation);
    await executor.query(`
      INSERT INTO engine_seed_calculations (
        id, tournament_id, input_digest, rules_version, created_at, metadata
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, '{}'::jsonb)
    `, [
      calculation.seedCalculationId, tournamentId, calculation.inputDigest,
      calculation.rulesVersion, occurredAt
    ]);
    for (const row of calculation.rows) {
      if (row.calculatedSeed === null) {
        invariant("Only a complete global seed review may materialize.");
      }
      await executor.query(`
        INSERT INTO engine_seed_rows (
          id, tournament_id, calculation_id, team_id, public_key,
          calculated_seed, qualified, metadata
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, true, '{}'::jsonb)
      `, [
        randomUUID(), tournamentId, calculation.seedCalculationId, row.teamId,
        `seed-${calculation.seedCalculationId}-${row.teamId}`,
        row.calculatedSeed
      ]);
    }
    const finalizations = await executor.query<{
      pod_id: string;
      finalization_id: string;
    }>(`
      SELECT id::text AS pod_id, active_finalization_id::text AS finalization_id
      FROM engine_pods WHERE tournament_id = $1::uuid ORDER BY sequence
    `, [tournamentId]);
    for (const row of finalizations.rows) {
      await executor.query(`
        INSERT INTO engine_seed_calculation_finalizations (
          tournament_id, calculation_id, pod_id, finalization_id
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
      `, [
        tournamentId, calculation.seedCalculationId,
        row.pod_id, row.finalization_id
      ]);
    }
    await executor.query(`
      INSERT INTO engine_active_seed_calculations (
        tournament_id, calculation_id, activated_at
      ) VALUES ($1::uuid, $2::uuid, $3)
      ON CONFLICT (tournament_id) DO UPDATE SET
        calculation_id = EXCLUDED.calculation_id,
        activated_at = EXCLUDED.activated_at
    `, [tournamentId, calculation.seedCalculationId, occurredAt]);
    await executor.query(
      "DELETE FROM engine_effective_seeds WHERE tournament_id = $1::uuid",
      [tournamentId]
    );
    for (const row of plan.rows) {
      await executor.query(`
        INSERT INTO engine_effective_seeds (
          tournament_id, team_id, calculated_seed, effective_seed,
          override_id, updated_at
        ) VALUES ($1::uuid, $2::uuid, $3, $4, NULL, $5)
      `, [
        tournamentId, row.teamId, row.calculatedSeed,
        row.effectiveSeed, occurredAt
      ]);
    }
    return {
      tournamentId,
      calculationId: calculation.seedCalculationId,
      effectiveSeeds: plan.rows.map((row) => ({
        teamId: row.teamId,
        calculatedSeed: row.calculatedSeed,
        effectiveSeed: row.effectiveSeed
      })),
      tournamentRowVersion
    };
  }

  private async readBracket(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    bracket: ProgressionBracketRow
  ): Promise<TournamentProgressionRecord["activeBracket"]> {
    const matches = (await executor.query<ProgressionBracketMatchRow>(`
      SELECT round.id::text AS round_id, round.public_key AS round_public_key,
             round.name AS round_name, round.sequence AS round_sequence,
             node.id::text AS bracket_match_id, node.public_key, node.sequence,
             node.playable, node.match_id::text, match.status AS match_status,
             match.score_availability,
             CASE WHEN match.id IS NULL THEN NULL
                  ELSE COALESCE((match.metadata ->> 'instanceNumber')::integer, 1)
             END AS instance_number,
             side_one.team_id::text AS side_one_team_id,
             side_two.team_id::text AS side_two_team_id,
             CASE WHEN match.id IS NULL THEN NULL
                  ELSE match.participants_frozen_at IS NOT NULL
             END AS participants_frozen,
             active.resolution_id::text,
             resolution.winner_team_id::text
      FROM engine_bracket_rounds round
      JOIN engine_bracket_matches node ON node.round_id = round.id
      LEFT JOIN engine_matches match ON match.id = node.match_id
      LEFT JOIN engine_match_slots side_one
        ON side_one.match_id = match.id AND side_one.slot_number = 1
      LEFT JOIN engine_match_slots side_two
        ON side_two.match_id = match.id AND side_two.slot_number = 2
      LEFT JOIN engine_active_bracket_match_resolutions active
        ON active.bracket_match_id = node.id
      LEFT JOIN engine_bracket_match_resolutions resolution
        ON resolution.id = active.resolution_id
      WHERE round.tournament_id = $1::uuid AND round.bracket_id = $2::uuid
      ORDER BY round.sequence, node.sequence
    `, [tournamentId, bracket.bracket_id])).rows;
    const slots = (await executor.query<ProgressionBracketSlotRow>(`
      SELECT slot.bracket_match_id::text, slot.slot_number, slot.source_type,
             slot.team_id::text, team.name AS team_name,
             slot.source_bracket_match_id::text, slot.seed
      FROM engine_bracket_slots slot
      JOIN engine_bracket_matches node ON node.id = slot.bracket_match_id
      LEFT JOIN engine_teams team ON team.id = slot.team_id
      WHERE node.tournament_id = $1::uuid AND node.bracket_id = $2::uuid
      ORDER BY node.sequence, slot.slot_number
    `, [tournamentId, bracket.bracket_id])).rows;
    const rounds = new Map<string, BracketRoundRecord>();
    for (const row of matches) {
      const match: BracketMatchRecord = {
        bracketMatchId: parseStableUuid(row.bracket_match_id, "bracket_match"),
        publicKey: row.public_key,
        sequence: row.sequence,
        playable: row.playable,
        ...(row.match_id === null
          ? {}
          : { matchId: parseStableUuid(row.match_id, "match") }),
        ...(row.instance_number === null
          ? {}
          : { instanceNumber: row.instance_number }),
        ...(row.side_one_team_id === null || row.side_two_team_id === null
          ? {}
          : {
              participantTeamIds: [
                parseStableUuid(row.side_one_team_id, "tournament_team"),
                parseStableUuid(row.side_two_team_id, "tournament_team")
              ] as const
            }),
        ...(row.participants_frozen === null
          ? {}
          : { participantsFrozen: row.participants_frozen }),
        ...(row.match_status === null ? {} : { matchStatus: row.match_status }),
        ...(row.score_availability === null
          ? {}
          : { scoreAvailability: row.score_availability }),
        ...(row.resolution_id === null ? {} : { resolutionId: row.resolution_id }),
        ...(row.winner_team_id === null ? {} : {
          winnerTeamId: parseStableUuid(row.winner_team_id, "tournament_team")
        }),
        slots: slots
          .filter((slot) => slot.bracket_match_id === row.bracket_match_id)
          .map(mapBracketSlot)
      };
      const current = rounds.get(row.round_id);
      if (current === undefined) {
        rounds.set(row.round_id, {
          roundId: parseStableUuid(row.round_id, "bracket_round"),
          publicKey: row.round_public_key,
          name: row.round_name,
          sequence: row.round_sequence,
          matches: [match]
        });
      } else {
        rounds.set(row.round_id, {
          ...current,
          matches: [...current.matches, match]
        });
      }
    }
    return {
      bracketId: parseStableUuid(bracket.bracket_id, "bracket"),
      publicKey: bracket.public_key,
      name: bracket.name,
      status: bracket.status,
      cumulativeWorkbookId: bracket.cumulative_workbook_id,
      rounds: [...rounds.values()].sort((left, right) =>
        left.sequence - right.sequence
      )
    };
  }

  private async insertPlayoffMatch(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    match: PublishBracketInput["bracket"]["rounds"][number]["matches"][number]["match"],
    createdAt: string
  ): Promise<void> {
    if (match === undefined) invariant("Playable bracket node requires a match.");
    const reserved = (await executor.query<{
      public_key: string;
      identity_only: boolean;
    }>(`
      SELECT public_key, identity_only
      FROM engine_matches
      WHERE tournament_id = $1::uuid AND id = $2::uuid
      FOR UPDATE
    `, [tournamentId, match.id])).rows[0];
    if (reserved !== undefined) {
      if (!reserved.identity_only || reserved.public_key !== match.publicKey) {
        conflict("Reserved playoff match identity changed before materialization.");
      }
      await executor.query(`
        UPDATE engine_matches
        SET stage = 'playoffs', sequence = $3, identity_only = false,
            status = 'scheduled', score_availability = 'not_started',
            scheduled_at = $4, updated_at = $5, metadata = $6::jsonb
        WHERE tournament_id = $1::uuid AND id = $2::uuid AND identity_only
      `, [
        tournamentId, match.id, match.sequence, match.scheduledAt ?? null,
        createdAt, writeEngineJson(match.metadata ?? {})
      ]);
      return;
    }
    await executor.query(`
      INSERT INTO match_identities (match_id, tournament_id, created_at)
      SELECT $2, tournament.public_key, $3
      FROM engine_tournaments tournament WHERE tournament.id = $1::uuid
    `, [tournamentId, match.publicKey, createdAt]);
    await executor.query(`
      INSERT INTO engine_matches (
        id, tournament_id, public_key, stage, pod_id, sequence,
        identity_only, status, score_availability, scheduled_at,
        row_version, created_at, updated_at, metadata
      ) VALUES (
        $1::uuid, $2::uuid, $3, 'playoffs', NULL, $4,
        false, 'scheduled', 'not_started', $5,
        1, $6, $6, $7::jsonb
      )
    `, [
      match.id, tournamentId, match.publicKey, match.sequence,
      match.scheduledAt ?? null, createdAt, writeEngineJson(match.metadata ?? {})
    ]);
  }

  private async reservePlayoffMatchIdentity(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    match: Omit<
      NonNullable<PublishBracketInput["bracket"]["rounds"][number]["matches"][number]["match"]>,
      "slots"
    >,
    createdAt: string
  ): Promise<void> {
    await executor.query(`
      INSERT INTO match_identities (match_id, tournament_id, created_at)
      SELECT $2, tournament.public_key, $3
      FROM engine_tournaments tournament WHERE tournament.id = $1::uuid
    `, [tournamentId, match.publicKey, createdAt]);
    await executor.query(`
      INSERT INTO engine_matches (
        id, tournament_id, public_key, stage, pod_id, sequence,
        identity_only, status, score_availability, row_version,
        created_at, updated_at, metadata
      ) VALUES (
        $1::uuid, $2::uuid, $3, 'legacy_unknown', NULL, NULL,
        true, NULL, 'not_started', 1, $4, $4, $5::jsonb
      )
    `, [
      match.id, tournamentId, match.publicKey, createdAt,
      writeEngineJson({
        ...(match.metadata ?? {}),
        reservedPlayoffSequence: match.sequence,
        reservedScheduledAt: match.scheduledAt ?? null
      })
    ]);
  }

  private async persistBracketResolution(
    executor: EnginePostgresExecutor,
    input: Omit<ResolveBracketMatchInput, "expectedTournamentRowVersion">
      & {
        readonly advancementId?: string;
        readonly allowFrozenDestination?: boolean;
      }
  ): Promise<ResolveBracketMatchResult["advancedToBracketMatchId"]> {
    requireDigest(input.confirmationDigest);
    const destination = (await executor.query<{
      bracket_match_id: string;
      slot_number: 1 | 2;
      team_id: string | null;
      match_id: string | null;
      participants_frozen_at: Date | string | null;
    }>(`
      SELECT slot.bracket_match_id::text, slot.slot_number, slot.team_id::text,
             destination.match_id::text, match.participants_frozen_at
      FROM engine_bracket_slots slot
      JOIN engine_bracket_matches destination
        ON destination.id = slot.bracket_match_id
      LEFT JOIN engine_matches match ON match.id = destination.match_id
      WHERE slot.tournament_id = $1::uuid
        AND slot.source_bracket_match_id = $2::uuid
      FOR UPDATE OF slot, destination
    `, [input.tournamentId, input.bracketMatchId])).rows[0];
    if (
      destination?.participants_frozen_at !== null &&
      destination?.participants_frozen_at !== undefined &&
      destination.team_id !== input.winnerTeamId &&
      input.allowFrozenDestination !== true
    ) {
      invariant("A started dependent match requires confirmed instance replacement.");
    }
    await executor.query(`
      INSERT INTO engine_bracket_match_resolutions (
        id, tournament_id, bracket_match_id, match_id, revision_id,
        winner_team_id, resolution_type, match_status, confirmation_digest,
        resolved_by_admin_id, resolved_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        $6::uuid, $7, $8, $9, $10::uuid, $11
      )
    `, [
      input.resolutionId, input.tournamentId, input.bracketMatchId,
      input.matchId ?? null, input.revisionId ?? null, input.winnerTeamId,
      input.resolutionType, input.matchStatus, input.confirmationDigest,
      input.administratorId, input.occurredAt
    ]);
    await executor.query(`
      INSERT INTO engine_active_bracket_match_resolutions (
        tournament_id, bracket_match_id, resolution_id, activated_at
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
      ON CONFLICT (tournament_id, bracket_match_id) DO UPDATE SET
        resolution_id = EXCLUDED.resolution_id,
        activated_at = EXCLUDED.activated_at
    `, [
      input.tournamentId, input.bracketMatchId,
      input.resolutionId, input.occurredAt
    ]);
    if (destination === undefined) return undefined;
    const advancementId = input.advancementId ?? randomUUID();
    await executor.query(`
      INSERT INTO engine_bracket_advancements (
        id, tournament_id, source_bracket_match_id, source_resolution_id,
        destination_bracket_match_id, destination_slot_number,
        winner_team_id, previous_team_id, confirmation_digest,
        advanced_by_admin_id, advanced_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        $5::uuid, $6, $7::uuid, $8::uuid, $9, $10::uuid, $11
      )
    `, [
      advancementId, input.tournamentId, input.bracketMatchId,
      input.resolutionId, destination.bracket_match_id,
      destination.slot_number, input.winnerTeamId, destination.team_id,
      input.confirmationDigest, input.administratorId, input.occurredAt
    ]);
    await executor.query(`
      UPDATE engine_bracket_slots SET team_id = $3::uuid
      WHERE tournament_id = $1::uuid AND bracket_match_id = $2::uuid
        AND slot_number = $4
    `, [
      input.tournamentId, destination.bracket_match_id,
      input.winnerTeamId, destination.slot_number
    ]);
    let destinationMatchId = destination.match_id;
    if (destinationMatchId === null) {
      const pending = await executor.query<{
        bracket_match_id: string;
        match_sequence: number;
        slot_id: string;
        public_key: string;
        slot_number: 1 | 2;
        source_type: "team" | "match_winner" | "bye" | "tbd";
        team_id: string | null;
        source_bracket_match_id: string | null;
        seed: number | null;
        reserved_match_id: string | null;
        reserved_public_key: string | null;
        reserved_sequence: number | null;
        reserved_scheduled_at: string | null;
        reserved_metadata: Record<string, unknown> | null;
      }>(`
        SELECT node.id::text AS bracket_match_id,
               ((
                   SELECT COALESCE(MAX(pod_match.sequence), 0)
                   FROM engine_matches pod_match
                   WHERE pod_match.tournament_id = node.tournament_id
                     AND pod_match.stage = 'pod_play'
                 ) + (
                   SELECT count(*)::integer
                   FROM engine_bracket_matches preceding
                   JOIN engine_bracket_rounds preceding_round
                     ON preceding_round.id = preceding.round_id
                   WHERE preceding.bracket_id = node.bracket_id
                     AND (
                       preceding_round.sequence < bracket_round.sequence
                       OR (
                         preceding_round.sequence = bracket_round.sequence
                         AND preceding.sequence <= node.sequence
                       )
                     )
                 ))::integer AS match_sequence,
               slot.id::text AS slot_id, slot.public_key, slot.slot_number,
               slot.source_type, slot.team_id::text,
               slot.source_bracket_match_id::text, slot.seed,
               planned.replacement_match_id::text AS reserved_match_id,
               planned.public_key AS reserved_public_key,
               planned.replacement_sequence AS reserved_sequence,
               planned.metadata ->> 'reservedScheduledAt' AS reserved_scheduled_at,
               planned.metadata AS reserved_metadata
        FROM engine_bracket_matches node
        JOIN engine_bracket_rounds bracket_round ON bracket_round.id = node.round_id
        JOIN engine_bracket_slots slot ON slot.bracket_match_id = node.id
        LEFT JOIN LATERAL (
          SELECT replacement.replacement_match_id,
                 replacement.replacement_sequence,
                 reserved.public_key, reserved.metadata
          FROM engine_bracket_match_replacements replacement
          JOIN engine_matches reserved
            ON reserved.id = replacement.replacement_match_id
           AND reserved.identity_only
          WHERE replacement.tournament_id = node.tournament_id
            AND replacement.bracket_match_id = node.id
            AND replacement.create_when_playable
          ORDER BY replacement.replaced_at DESC, replacement.id DESC
          LIMIT 1
        ) planned ON true
        WHERE node.tournament_id = $1::uuid AND node.id = $2::uuid
        ORDER BY slot.slot_number
      `, [input.tournamentId, destination.bracket_match_id]);
      if (
        pending.rows.length === 2 &&
        pending.rows.every((row) => row.team_id !== null)
      ) {
        const bracketMatchId = parseStableUuid(
          destination.bracket_match_id, "bracket_match"
        );
        const firstPending = pending.rows[0];
        const matchId = firstPending?.reserved_match_id === null ||
          firstPending?.reserved_match_id === undefined
          ? createStablePlayoffMatchInstanceId({
            tournamentId: input.tournamentId,
            bracketMatchId,
            instanceNumber: 1
          })
          : parseStableUuid(firstPending.reserved_match_id, "match");
        const matchSlots = pending.rows.map((row) => ({
          id: row.slot_id,
          publicKey: row.public_key,
          slotNumber: row.slot_number,
          sourceType: row.source_type,
          teamId: parseStableUuid(row.team_id as string, "tournament_team"),
          ...(row.source_bracket_match_id === null ? {} : {
            sourceBracketMatchId: parseStableUuid(
              row.source_bracket_match_id, "bracket_match"
            )
          }),
          ...(row.seed === null ? {} : { seed: row.seed })
        })) as unknown as PublishBracketInput["bracket"]["rounds"][number]["matches"][number]["slots"];
        await this.insertPlayoffMatch(executor, input.tournamentId, {
          id: matchId,
          publicKey: firstPending?.reserved_public_key ?? matchId,
          sequence: firstPending?.reserved_sequence ??
            firstPending?.match_sequence ?? 0,
          ...(firstPending?.reserved_scheduled_at === null ||
              firstPending?.reserved_scheduled_at === undefined
            ? {}
            : { scheduledAt: firstPending.reserved_scheduled_at }),
          slots: matchSlots,
          metadata: firstPending?.reserved_metadata ?? {
            bracketMatchId,
            instanceNumber: 1
          }
        }, input.occurredAt);
        for (const slot of matchSlots) {
          await executor.query(`
            INSERT INTO engine_match_slots (
              tournament_id, match_id, slot_number, source_type,
              team_id, source_match_id, seed, metadata
            ) VALUES ($1::uuid, $2::uuid, $3, 'team', $4::uuid, NULL, $5, '{}'::jsonb)
          `, [
            input.tournamentId, matchId, slot.slotNumber,
            slot.teamId, slot.seed ?? null
          ]);
        }
        await executor.query(`
          UPDATE engine_bracket_matches
          SET playable = true, match_id = $3::uuid
          WHERE tournament_id = $1::uuid AND id = $2::uuid
            AND NOT playable AND match_id IS NULL
        `, [input.tournamentId, destination.bracket_match_id, matchId]);
        destinationMatchId = matchId;
      }
    }
    if (destinationMatchId !== null &&
        destination.participants_frozen_at === null) {
      await executor.query(`
        UPDATE engine_match_slots SET team_id = $3::uuid
        WHERE tournament_id = $1::uuid AND match_id = $2::uuid
          AND slot_number = $4
      `, [
        input.tournamentId, destinationMatchId,
        input.winnerTeamId, destination.slot_number
      ]);
      await executor.query(`
        UPDATE engine_bracket_matches SET playable = true
        WHERE tournament_id = $1::uuid AND id = $2::uuid
          AND match_id = $3::uuid AND NOT playable
          AND (
            SELECT count(*) = 2 AND count(team_id) = 2
            FROM engine_bracket_slots slot
            WHERE slot.bracket_match_id = $2::uuid
          )
      `, [
        input.tournamentId, destination.bracket_match_id,
        destinationMatchId
      ]);
    }
    return parseStableUuid(destination.bracket_match_id, "bracket_match");
  }
}
