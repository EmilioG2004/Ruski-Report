import { PostgresDatabase } from "../../database";
import { TransactionContext } from "../../repositories/transaction";
import { CopiedTournamentConfiguration } from "../configuration";
import { parseStableUuid, TournamentSetup } from "../domain";
import {
  generatePodRoundRobinSchedule,
  ScheduledPodMatch
} from "../scheduling";
import {
  CreateTournamentDraftInput,
  PublishTournamentSetupInput,
  TournamentSetupRepositoryContract,
  TournamentCommandResult
} from "./contracts";
import { TournamentEngineTransactionManager } from "./engine-transaction.manager";
import {
  EnginePersistenceConflictError,
  EnginePersistenceInvariantError
} from "./errors";
import {
  engineExecutor,
  EnginePostgresExecutor,
  lockEngineTournament,
  writeEngineAuditEvent,
  writeEngineJson
} from "./postgres-engine-executor";

interface TournamentLockRow {
  lifecycle: string;
  public_key: string;
  row_version: string | number;
}

interface PublicTournamentIdentityRow {
  game_type: string;
  year: number;
}

interface ConfigurationRow {
  format_version: number;
  format_type: string;
  team_count: number;
  pod_count: number;
  pod_sizes: number[];
  players_per_team: number;
  games_per_pair: number;
  qualifiers_per_pod: number;
  bracket_size: number;
  allow_byes: boolean;
  standings_rules: string[];
  copied_from_preset_id: string | null;
}

interface StoredPodRow {
  id: string;
  name: string;
  sequence: number;
}

interface StoredTeamRow {
  id: string;
  name: string;
  player_ids: string[];
}

interface StoredAssignmentRow {
  pod_id: string;
  team_id: string;
  initial_seed: number;
}

export class PostgresTournamentSetupRepository
implements TournamentSetupRepositoryContract {
  private readonly transactions: TournamentEngineTransactionManager;

  constructor(
    private readonly database: PostgresDatabase,
    transactions?: TournamentEngineTransactionManager
  ) {
    this.transactions = transactions ?? new TournamentEngineTransactionManager(database);
  }

  createDraft(
    input: CreateTournamentDraftInput
  ): Promise<TournamentCommandResult> {
    return this.transactions.run((transaction) =>
      this.createDraftInTransaction(input, transaction)
    );
  }

  publishSetup(
    input: PublishTournamentSetupInput
  ): Promise<TournamentCommandResult> {
    return this.transactions.run((transaction) =>
      this.publishSetupInTransaction(input, transaction)
    );
  }

  async createDraftInTransaction(
    input: CreateTournamentDraftInput,
    transaction: TransactionContext
  ): Promise<TournamentCommandResult> {
    const executor = engineExecutor(this.database, transaction);
    const { tournament, configuration } = input;
    await lockEngineTournament(executor, tournament.id);
    await this.ensurePublicTournamentIdentity(executor, input);

    await executor.query(
      `
        INSERT INTO engine_tournaments (
          id, public_key, game_type, year, name, lifecycle, visibility,
          row_version, created_at, updated_at, metadata
        ) VALUES (
          $1::uuid, $2, $3, $4, $5, 'draft_setup', $6,
          1, $7, $7, $8::jsonb
        )
      `,
      [
        tournament.id,
        tournament.publicKey,
        tournament.gameType,
        tournament.year,
        tournament.name,
        tournament.visibility,
        input.createdAt,
        writeEngineJson(tournament.metadata ?? {})
      ]
    );

    await executor.query(
      `
        INSERT INTO engine_tournament_configurations (
          tournament_id, format_version, format_type, team_count, pod_count,
          pod_sizes, players_per_team, games_per_pair, qualifiers_per_pod,
          bracket_size, allow_byes, standings_rules, copied_from_preset_id,
          metadata
        ) VALUES (
          $1::uuid, $2, $3, $4, $5,
          $6::smallint[], $7, $8, $9,
          $10, $11, $12::text[], $13, $14::jsonb
        )
      `,
      [
        tournament.id,
        configuration.formatVersion,
        configuration.formatType,
        configuration.teamCount,
        configuration.podCount,
        configuration.podSizes,
        configuration.playersPerTeam,
        configuration.gamesPerPair,
        configuration.qualifiersPerPod,
        configuration.bracketSize,
        configuration.allowByes,
        configuration.standingsRules,
        configuration.copiedFromPresetId ?? null,
        writeEngineJson({})
      ]
    );

    for (const pod of input.pods) {
      await executor.query(
        `
          INSERT INTO engine_pods (
            id, tournament_id, public_key, name, normalized_name,
            sequence, metadata
          ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)
        `,
        [
          pod.id,
          tournament.id,
          pod.publicKey,
          pod.name,
          pod.normalizedName,
          pod.sequence,
          writeEngineJson(pod.metadata ?? {})
        ]
      );
    }

    const openedBy = input.audit.actor.id ?? input.audit.actor.kind;
    for (const team of input.teams) {
      await this.insertTeam(executor, input, team, openedBy);
    }

    await writeEngineAuditEvent(executor, tournament.id, input.audit);
    return {
      tournamentId: tournament.id,
      lifecycle: "draft_setup",
      rowVersion: 1
    };
  }

  async publishSetupInTransaction(
    input: PublishTournamentSetupInput,
    transaction: TransactionContext
  ): Promise<TournamentCommandResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const tournament = await this.lockTournamentRow(executor, input.tournamentId);

    if (tournament.lifecycle !== "draft_setup") {
      throw new EnginePersistenceConflictError(
        "Only a draft tournament setup can be published."
      );
    }
    if (Number(tournament.row_version) !== input.expectedRowVersion) {
      throw new EnginePersistenceConflictError(
        "Tournament setup changed after the publish command was prepared."
      );
    }

    const configuration = await this.readConfiguration(
      executor,
      input.tournamentId
    );
    await this.assertStoredSetupComplete(executor, input, configuration);
    const canonicalSchedule = await this.generateStoredCanonicalSchedule(
      executor,
      input.tournamentId,
      configuration
    );
    assertCanonicalPublishedSchedule(input.schedule, canonicalSchedule);

    for (const match of input.schedule) {
      if (match.tournamentId !== input.tournamentId) {
        throw new EnginePersistenceInvariantError(
          "Scheduled matches must belong to the tournament being published."
        );
      }

      await this.ensurePublicMatchIdentity(
        executor,
        match.id,
        tournament.public_key,
        input.publishedAt
      );

      await executor.query(
        `
          INSERT INTO engine_matches (
            id, tournament_id, public_key, stage, pod_id, sequence,
            identity_only, status, score_availability, scheduled_at,
            row_version, created_at, updated_at, metadata
          ) VALUES (
            $1::uuid, $2::uuid, $1::text, 'pod_play', $3::uuid, $4,
            false, 'scheduled', 'not_started', $5,
            1, $6, $6, $7::jsonb
          )
        `,
        [
          match.id,
          input.tournamentId,
          match.podId,
          match.sequence,
          match.scheduledAt,
          input.publishedAt,
          writeEngineJson({
            sequenceInPod: match.sequenceInPod,
            roundNumber: match.roundNumber,
            gameNumberForPair: match.gameNumberForPair
          })
        ]
      );

      for (const [index, teamId] of match.participantTeamIds.entries()) {
        await executor.query(
          `
            INSERT INTO engine_match_slots (
              tournament_id, match_id, slot_number, source_type, team_id
            ) VALUES ($1::uuid, $2::uuid, $3, 'team', $4::uuid)
          `,
          [input.tournamentId, match.id, index + 1, teamId]
        );
      }
    }

    await executor.query(
      `
        UPDATE engine_tournament_configurations
        SET locked_at = $2
        WHERE tournament_id = $1::uuid AND locked_at IS NULL
      `,
      [input.tournamentId, input.publishedAt]
    );

    const updated = await executor.query<{ row_version: string | number }>(
      `
        UPDATE engine_tournaments
        SET lifecycle = 'setup_published',
            setup_published_at = $3,
            row_version = row_version + 1,
            updated_at = $3
        WHERE id = $1::uuid
          AND lifecycle = 'draft_setup'
          AND row_version = $2
        RETURNING row_version
      `,
      [input.tournamentId, input.expectedRowVersion, input.publishedAt]
    );
    const rowVersion = updated.rows[0]?.row_version;
    if (rowVersion === undefined) {
      throw new EnginePersistenceConflictError(
        "Tournament setup could not be published at the expected version."
      );
    }

    await writeEngineAuditEvent(executor, input.tournamentId, input.audit);
    return {
      tournamentId: input.tournamentId,
      lifecycle: "setup_published",
      rowVersion: Number(rowVersion)
    };
  }

  private async insertTeam(
    executor: EnginePostgresExecutor,
    input: CreateTournamentDraftInput,
    team: CreateTournamentDraftInput["teams"][number],
    openedBy: string
  ): Promise<void> {
    const tournamentId = input.tournament.id;
    await executor.query(
      `
        INSERT INTO engine_teams (
          id, tournament_id, public_key, name, normalized_name,
          sequence, metadata
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        team.id,
        tournamentId,
        team.publicKey,
        team.name,
        team.normalizedName,
        team.sequence,
        writeEngineJson(team.metadata ?? {})
      ]
    );
    await executor.query(
      `
        INSERT INTO engine_pod_teams (
          tournament_id, pod_id, team_id, initial_seed, assigned_at
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
      `,
      [tournamentId, team.podId, team.id, team.initialSeed, input.createdAt]
    );

    for (const player of team.players) {
      await executor.query(
        `
          INSERT INTO engine_players (
            id, tournament_id, public_key, display_name, first_name,
            last_name, preferred_name, created_at, metadata
          ) VALUES (
            $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::jsonb
          )
        `,
        [
          player.id,
          tournamentId,
          player.publicKey,
          player.displayName,
          player.firstName ?? null,
          player.lastName ?? null,
          player.preferredName ?? null,
          input.createdAt,
          writeEngineJson(player.metadata ?? {})
        ]
      );
      await executor.query(
        `
          INSERT INTO engine_roster_memberships (
            id, tournament_id, public_key, team_id, player_id, roster_slot,
            opened_at, opened_by, metadata
          ) VALUES (
            $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6,
            $7, $8, $9::jsonb
          )
        `,
        [
          player.membershipId,
          tournamentId,
          player.membershipPublicKey,
          team.id,
          player.id,
          player.rosterSlot,
          input.createdAt,
          openedBy,
          writeEngineJson({})
        ]
      );
    }
  }

  private async lockTournamentRow(
    executor: EnginePostgresExecutor,
    tournamentId: string
  ): Promise<TournamentLockRow> {
    const result = await executor.query<TournamentLockRow>(
      `
        SELECT lifecycle, public_key, row_version
        FROM engine_tournaments
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [tournamentId]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new EnginePersistenceInvariantError("Tournament was not found.");
    }
    return row;
  }

  private async ensurePublicTournamentIdentity(
    executor: EnginePostgresExecutor,
    input: CreateTournamentDraftInput
  ): Promise<void> {
    const tournament = input.tournament;
    await executor.query(
      `
        INSERT INTO tournaments (id, game_type, year, name, created_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        tournament.publicKey,
        tournament.gameType,
        tournament.year,
        tournament.name,
        input.createdAt
      ]
    );
    const identity = await executor.query<PublicTournamentIdentityRow>(
      `
        SELECT game_type, year
        FROM tournaments
        WHERE id = $1
        FOR KEY SHARE
      `,
      [tournament.publicKey]
    );
    const row = identity.rows[0];
    if (
      row === undefined ||
      row.game_type !== tournament.gameType ||
      row.year !== tournament.year
    ) {
      throw new EnginePersistenceInvariantError(
        "Public tournament identity conflicts with an existing tournament."
      );
    }
  }

  private async ensurePublicMatchIdentity(
    executor: EnginePostgresExecutor,
    matchId: string,
    publicTournamentId: string,
    createdAt: string
  ): Promise<void> {
    await executor.query(
      `
        INSERT INTO match_identities (match_id, tournament_id, created_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (match_id) DO NOTHING
      `,
      [matchId, publicTournamentId, createdAt]
    );
    const identity = await executor.query<{ tournament_id: string }>(
      `
        SELECT tournament_id
        FROM match_identities
        WHERE match_id = $1
        FOR KEY SHARE
      `,
      [matchId]
    );
    if (identity.rows[0]?.tournament_id !== publicTournamentId) {
      throw new EnginePersistenceInvariantError(
        "Public match identity conflicts with another tournament."
      );
    }
  }

  private async readConfiguration(
    executor: EnginePostgresExecutor,
    tournamentId: string
  ): Promise<ConfigurationRow> {
    const result = await executor.query<ConfigurationRow>(
      `
        SELECT format_version, format_type, team_count, pod_count, pod_sizes,
               players_per_team, games_per_pair, qualifiers_per_pod,
               bracket_size, allow_byes, standings_rules,
               copied_from_preset_id
        FROM engine_tournament_configurations
        WHERE tournament_id = $1::uuid
      `,
      [tournamentId]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new EnginePersistenceInvariantError(
        "Tournament configuration was not found."
      );
    }
    return row;
  }

  private async generateStoredCanonicalSchedule(
    executor: EnginePostgresExecutor,
    tournamentId: string,
    row: ConfigurationRow
  ): Promise<ScheduledPodMatch[]> {
    const pods = await executor.query<StoredPodRow>(
      `
        SELECT id::text, name, sequence
        FROM engine_pods
        WHERE tournament_id = $1::uuid
        ORDER BY sequence
      `,
      [tournamentId]
    );
    const teams = await executor.query<StoredTeamRow>(
      `
        SELECT team.id::text,
               team.name,
               COALESCE(
                 array_agg(membership.player_id ORDER BY membership.roster_slot)
                   FILTER (WHERE membership.id IS NOT NULL),
                 ARRAY[]::uuid[]
               ) AS player_ids
        FROM engine_teams team
        LEFT JOIN engine_roster_memberships membership
          ON membership.tournament_id = team.tournament_id
         AND membership.team_id = team.id
         AND membership.closed_at IS NULL
        WHERE team.tournament_id = $1::uuid
        GROUP BY team.id, team.name, team.sequence
        ORDER BY team.sequence
      `,
      [tournamentId]
    );
    const assignments = await executor.query<StoredAssignmentRow>(
      `
        SELECT pod_id::text, team_id::text, initial_seed
        FROM engine_pod_teams
        WHERE tournament_id = $1::uuid
        ORDER BY pod_id, initial_seed
      `,
      [tournamentId]
    );
    const configuration: CopiedTournamentConfiguration = {
      formatVersion: row.format_version,
      formatType: row.format_type as CopiedTournamentConfiguration["formatType"],
      teamCount: row.team_count,
      podCount: row.pod_count,
      podSizes: row.pod_sizes,
      playersPerTeam: row.players_per_team,
      gamesPerPair: row.games_per_pair,
      qualifiersPerPod: row.qualifiers_per_pod,
      bracketSize: row.bracket_size,
      allowByes: row.allow_byes,
      standingsRules:
        row.standings_rules as unknown as CopiedTournamentConfiguration["standingsRules"],
      ...(row.copied_from_preset_id === null
        ? {}
        : { copiedFromPresetId: row.copied_from_preset_id })
    };
    const setup: TournamentSetup = {
      tournamentId: parseStableUuid(tournamentId, "tournament"),
      teams: teams.rows.map((team) => ({
        id: parseStableUuid(team.id, "tournament_team"),
        name: team.name,
        playerIds: team.player_ids.map((playerId) =>
          parseStableUuid(playerId, "tournament_player")
        )
      })),
      pods: pods.rows.map((pod) => ({
        id: parseStableUuid(pod.id, "pod"),
        name: pod.name,
        sequence: pod.sequence,
        teamAssignments: assignments.rows
          .filter((assignment) => assignment.pod_id === pod.id)
          .map((assignment) => ({
            teamId: parseStableUuid(assignment.team_id, "tournament_team"),
            initialSeed: assignment.initial_seed
          }))
      }))
    };
    return generatePodRoundRobinSchedule(configuration, setup);
  }

  private async assertStoredSetupComplete(
    executor: EnginePostgresExecutor,
    input: PublishTournamentSetupInput,
    configuration: ConfigurationRow
  ): Promise<void> {
    const counts = await executor.query<{
      pod_count: string | number;
      team_count: string | number;
      invalid_pod_count: string | number;
      invalid_roster_count: string | number;
      invalid_seed_count: string | number;
    }>(
      `
        WITH pod_counts AS (
          SELECT pod.id, pod.sequence, count(assignment.team_id)::integer AS teams
          FROM engine_pods pod
          LEFT JOIN engine_pod_teams assignment
            ON assignment.tournament_id = pod.tournament_id
           AND assignment.pod_id = pod.id
          WHERE pod.tournament_id = $1::uuid
          GROUP BY pod.id, pod.sequence
        ), roster_counts AS (
          SELECT team.id, count(membership.id)::integer AS players
          FROM engine_teams team
          LEFT JOIN engine_roster_memberships membership
            ON membership.tournament_id = team.tournament_id
           AND membership.team_id = team.id
           AND membership.closed_at IS NULL
          WHERE team.tournament_id = $1::uuid
          GROUP BY team.id
        ), seed_checks AS (
          SELECT pod_id,
                 count(*)::integer AS team_count,
                 min(initial_seed)::integer AS minimum_seed,
                 max(initial_seed)::integer AS maximum_seed,
                 count(DISTINCT initial_seed)::integer AS distinct_seeds
          FROM engine_pod_teams
          WHERE tournament_id = $1::uuid
          GROUP BY pod_id
        )
        SELECT
          (SELECT count(*) FROM engine_pods WHERE tournament_id = $1::uuid)
            AS pod_count,
          (SELECT count(*) FROM engine_teams WHERE tournament_id = $1::uuid)
            AS team_count,
          (SELECT count(*) FROM pod_counts
            WHERE teams <> ($2::smallint[])[sequence]) AS invalid_pod_count,
          (SELECT count(*) FROM roster_counts
            WHERE players <> $3) AS invalid_roster_count,
          (SELECT count(*) FROM seed_checks
            WHERE minimum_seed <> 1
               OR maximum_seed <> team_count
               OR distinct_seeds <> team_count) AS invalid_seed_count
      `,
      [
        input.tournamentId,
        configuration.pod_sizes,
        configuration.players_per_team
      ]
    );
    const row = counts.rows[0];
    const expectedMatches = configuration.pod_sizes.reduce(
      (total, podSize) =>
        total + podSize * (podSize - 1) / 2 * configuration.games_per_pair,
      0
    );
    const complete =
      Number(row?.pod_count) === configuration.pod_count &&
      Number(row?.team_count) === configuration.team_count &&
      Number(row?.invalid_pod_count) === 0 &&
      Number(row?.invalid_roster_count) === 0 &&
      Number(row?.invalid_seed_count) === 0 &&
      input.schedule.length === expectedMatches;

    if (!complete) {
      throw new EnginePersistenceInvariantError(
        "Stored setup and generated schedule do not satisfy the copied configuration."
      );
    }
  }
}

export function assertCanonicalPublishedSchedule(
  supplied: readonly ScheduledPodMatch[],
  canonical: readonly ScheduledPodMatch[]
): void {
  const suppliedById = new Map(supplied.map((match) => [match.id, match]));
  const suppliedSequences = new Set(supplied.map((match) => match.sequence));
  if (
    supplied.length !== canonical.length ||
    suppliedById.size !== supplied.length ||
    suppliedSequences.size !== supplied.length
  ) {
    throw new EnginePersistenceInvariantError(
      "Published schedule must be the complete unique canonical schedule."
    );
  }

  for (const expected of canonical) {
    const actual = suppliedById.get(expected.id);
    if (actual === undefined || !sameScheduledMatch(actual, expected)) {
      throw new EnginePersistenceInvariantError(
        "Published schedule differs from deterministic round-robin generation."
      );
    }
  }
}

function sameScheduledMatch(
  actual: ScheduledPodMatch,
  expected: ScheduledPodMatch
): boolean {
  return actual.id === expected.id &&
    actual.tournamentId === expected.tournamentId &&
    actual.podId === expected.podId &&
    actual.stage === expected.stage &&
    actual.sequence === expected.sequence &&
    actual.sequenceInPod === expected.sequenceInPod &&
    actual.roundNumber === expected.roundNumber &&
    actual.gameNumberForPair === expected.gameNumberForPair &&
    actual.participantTeamIds[0] === expected.participantTeamIds[0] &&
    actual.participantTeamIds[1] === expected.participantTeamIds[1] &&
    actual.status === expected.status &&
    actual.scoreAvailability === expected.scoreAvailability &&
    actual.scheduledAt === expected.scheduledAt;
}
