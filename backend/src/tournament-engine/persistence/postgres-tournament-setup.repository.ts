import { PostgresDatabase } from "../../database";
import { TransactionContext } from "../../repositories/transaction";
import {
  CopiedTournamentConfiguration,
  copyTournamentConfiguration
} from "../configuration";
import {
  parseStableUuid,
  TournamentId,
  TournamentLifecycle,
  TournamentSetup,
  TournamentVisibility
} from "../domain";
import {
  ScheduledPodMatch
} from "../scheduling";
import { createTournamentSetupPreview } from "../setup";
import {
  AdminTournamentSetupRecord,
  AdminTournamentSummaryRecord,
  CreateTournamentDraftInput,
  DraftPodInput,
  DraftTeamInput,
  PublishedTournamentSetupResult,
  PublishTournamentSetupInput,
  ReplaceTournamentDraftInput,
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
import {
  CanonicalProjectionActivationResult,
  PostgresProjectionRepository
} from "./postgres-projection.repository";
import {
  CanonicalProjectionActivationListener,
  notifyCanonicalProjectionActivation,
  refreshCanonicalProjectionInTransaction
} from "./projection-refresh";

interface TournamentLockRow {
  lifecycle: string;
  public_key: string;
  row_version: string | number;
}

interface TournamentSummaryRow {
  id: string;
  public_key: string;
  game_type: string;
  year: number;
  name: string;
  lifecycle: TournamentLifecycle;
  visibility: TournamentVisibility;
  row_version: string | number;
  setup_published_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
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
  public_key: string;
  name: string;
  normalized_name: string;
  sequence: number;
  metadata: Record<string, unknown>;
}

interface StoredTeamRow {
  id: string;
  public_key: string;
  name: string;
  normalized_name: string;
  sequence: number;
  pod_id: string;
  initial_seed: number;
  metadata: Record<string, unknown>;
}

interface StoredPlayerRow {
  id: string;
  public_key: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  membership_id: string;
  membership_public_key: string;
  team_id: string;
  roster_slot: number;
  metadata: Record<string, unknown>;
}

export class PostgresTournamentSetupRepository
implements TournamentSetupRepositoryContract {
  private readonly transactions: TournamentEngineTransactionManager;

  constructor(
    private readonly database: PostgresDatabase,
    transactions?: TournamentEngineTransactionManager,
    private readonly projections?: PostgresProjectionRepository,
    private readonly projectionListener?: CanonicalProjectionActivationListener
  ) {
    this.transactions = transactions ?? new TournamentEngineTransactionManager(database);
  }

  list(): Promise<readonly AdminTournamentSummaryRecord[]> {
    return this.transactions.run(async (transaction) => {
      const executor = engineExecutor(this.database, transaction);
      const result = await executor.query<TournamentSummaryRow>(`
        SELECT id::text, public_key, game_type, year, name, lifecycle,
               visibility, row_version, setup_published_at, created_at,
               updated_at
        FROM engine_tournaments
        ORDER BY updated_at DESC, id DESC
      `);
      return result.rows.map(mapTournamentSummary);
    }, { isolationLevel: "repeatable read", readOnly: true });
  }

  findById(
    tournamentId: TournamentId
  ): Promise<AdminTournamentSetupRecord | null> {
    return this.transactions.run(
      (transaction) => this.findByIdInTransaction(tournamentId, transaction),
      { isolationLevel: "repeatable read", readOnly: true }
    );
  }

  createDraft(
    input: CreateTournamentDraftInput
  ): Promise<TournamentCommandResult> {
    return this.transactions.run((transaction) =>
      this.createDraftInTransaction(input, transaction)
    );
  }

  replaceDraft(
    input: ReplaceTournamentDraftInput
  ): Promise<TournamentCommandResult> {
    return this.transactions.run((transaction) =>
      this.replaceDraftInTransaction(input, transaction)
    );
  }

  async publishSetup(
    input: PublishTournamentSetupInput
  ): Promise<PublishedTournamentSetupResult> {
    let projection: CanonicalProjectionActivationResult | undefined;
    const result = await this.transactions.run(async (transaction) => {
      const published = await this.publishSetupInTransaction(input, transaction);
      projection = await refreshCanonicalProjectionInTransaction(
        this.projections,
        {
          tournamentId: input.tournamentId,
          expectedTournamentRowVersion: published.rowVersion,
          occurredAt: input.publishedAt,
          sourceCommandType: input.audit.commandType,
          actor: input.audit.actor,
          sourceEventId: input.audit.eventId,
          correlationId: input.audit.correlationId
        },
        transaction
      );
      return published;
    });
    notifyCanonicalProjectionActivation(this.projectionListener, projection);
    return result;
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
      await this.insertTeam(
        executor,
        input.tournament.id,
        team,
        input.createdAt,
        openedBy
      );
    }

    await writeEngineAuditEvent(executor, tournament.id, input.audit);
    return {
      tournamentId: tournament.id,
      lifecycle: "draft_setup",
      rowVersion: 1
    };
  }

  async findByIdInTransaction(
    tournamentId: TournamentId,
    transaction: TransactionContext
  ): Promise<AdminTournamentSetupRecord | null> {
    const executor = engineExecutor(this.database, transaction);
    return this.readSetupRecord(executor, tournamentId);
  }

  async replaceDraftInTransaction(
    input: ReplaceTournamentDraftInput,
    transaction: TransactionContext
  ): Promise<TournamentCommandResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const tournament = await this.lockTournamentRow(executor, input.tournamentId);

    if (tournament.lifecycle !== "draft_setup") {
      throw new EnginePersistenceConflictError(
        "Only a draft tournament setup can be edited."
      );
    }
    if (Number(tournament.row_version) !== input.expectedRowVersion) {
      throw new EnginePersistenceConflictError(
        "Tournament setup changed after the edit command was prepared."
      );
    }

    await this.assertReplacementIdentityScope(executor, input);
    await this.replacePods(executor, input);
    await executor.query(
      "DELETE FROM engine_roster_memberships WHERE tournament_id = $1::uuid",
      [input.tournamentId]
    );
    await executor.query(
      "DELETE FROM engine_players WHERE tournament_id = $1::uuid",
      [input.tournamentId]
    );
    await executor.query(
      "DELETE FROM engine_pod_teams WHERE tournament_id = $1::uuid",
      [input.tournamentId]
    );
    await executor.query(
      "DELETE FROM engine_teams WHERE tournament_id = $1::uuid",
      [input.tournamentId]
    );

    const openedBy = input.audit.actor.id ?? input.audit.actor.kind;
    for (const team of input.teams) {
      await this.insertTeam(
        executor,
        input.tournamentId,
        team,
        input.updatedAt,
        openedBy
      );
    }

    const updated = await executor.query<{ row_version: string | number }>(
      `
        UPDATE engine_tournaments
        SET row_version = row_version + 1,
            updated_at = $3
        WHERE id = $1::uuid
          AND lifecycle = 'draft_setup'
          AND row_version = $2
        RETURNING row_version
      `,
      [input.tournamentId, input.expectedRowVersion, input.updatedAt]
    );
    const rowVersion = updated.rows[0]?.row_version;
    if (rowVersion === undefined) {
      throw new EnginePersistenceConflictError(
        "Tournament setup could not be edited at the expected version."
      );
    }

    await writeEngineAuditEvent(executor, input.tournamentId, input.audit);
    return {
      tournamentId: input.tournamentId,
      lifecycle: "draft_setup",
      rowVersion: Number(rowVersion)
    };
  }

  async publishSetupInTransaction(
    input: PublishTournamentSetupInput,
    transaction: TransactionContext
  ): Promise<PublishedTournamentSetupResult> {
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

    const setupRecord = await this.readSetupRecord(executor, input.tournamentId);
    if (setupRecord === null) {
      throw new EnginePersistenceInvariantError("Tournament was not found.");
    }
    const setup = toTournamentSetup(setupRecord);
    const preview = createTournamentSetupPreview(
      setupRecord.configuration,
      setup,
      Number(tournament.row_version)
    );
    if (!preview.valid || preview.digest === null) {
      throw new EnginePersistenceInvariantError(
        "Stored setup does not satisfy the copied configuration."
      );
    }
    if (preview.digest !== input.expectedPreviewDigest) {
      throw new EnginePersistenceConflictError(
        "Tournament setup differs from the confirmed schedule preview."
      );
    }
    const canonicalSchedule = preview.matches;

    for (const match of canonicalSchedule) {
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
            visibility = $4,
            setup_published_at = $3,
            row_version = row_version + 1,
            updated_at = $3
        WHERE id = $1::uuid
          AND lifecycle = 'draft_setup'
          AND row_version = $2
        RETURNING row_version
      `,
      [
        input.tournamentId,
        input.expectedRowVersion,
        input.publishedAt,
        input.visibility
      ]
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
      rowVersion: Number(rowVersion),
      matchCount: canonicalSchedule.length,
      setupPublishedAt: input.publishedAt
    };
  }

  private async insertTeam(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    team: DraftTeamInput,
    occurredAt: string,
    openedBy: string
  ): Promise<void> {
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
      [tournamentId, team.podId, team.id, team.initialSeed, occurredAt]
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
          occurredAt,
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
          occurredAt,
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

  private async readSetupRecord(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId
  ): Promise<AdminTournamentSetupRecord | null> {
    const tournamentResult = await executor.query<TournamentSummaryRow>(`
        SELECT id::text, public_key, game_type, year, name, lifecycle,
               visibility, row_version, setup_published_at, created_at,
               updated_at
        FROM engine_tournaments
        WHERE id = $1::uuid
      `, [tournamentId]);
    const tournament = tournamentResult.rows[0];
    if (tournament === undefined) {
      return null;
    }
    const configurationResult = await executor.query<ConfigurationRow>(`
        SELECT format_version, format_type, team_count, pod_count, pod_sizes,
               players_per_team, games_per_pair, qualifiers_per_pod,
               bracket_size, allow_byes, standings_rules,
               copied_from_preset_id
        FROM engine_tournament_configurations
        WHERE tournament_id = $1::uuid
      `, [tournamentId]);
    const podsResult = await executor.query<StoredPodRow>(`
        SELECT id::text, public_key, name, normalized_name, sequence, metadata
        FROM engine_pods
        WHERE tournament_id = $1::uuid
        ORDER BY sequence
      `, [tournamentId]);
    const teamsResult = await executor.query<StoredTeamRow>(`
        SELECT team.id::text, team.public_key, team.name,
               team.normalized_name, team.sequence, assignment.pod_id::text,
               assignment.initial_seed, team.metadata
        FROM engine_teams team
        JOIN engine_pod_teams assignment
          ON assignment.tournament_id = team.tournament_id
         AND assignment.team_id = team.id
        WHERE team.tournament_id = $1::uuid
        ORDER BY team.sequence
      `, [tournamentId]);
    const playersResult = await executor.query<StoredPlayerRow>(`
        SELECT player.id::text, player.public_key, player.display_name,
               player.first_name, player.last_name, player.preferred_name,
               membership.id::text AS membership_id,
               membership.public_key AS membership_public_key,
               membership.team_id::text, membership.roster_slot,
               player.metadata
        FROM engine_players player
        JOIN engine_roster_memberships membership
          ON membership.tournament_id = player.tournament_id
         AND membership.player_id = player.id
         AND membership.closed_at IS NULL
        WHERE player.tournament_id = $1::uuid
        ORDER BY membership.team_id, membership.roster_slot
      `, [tournamentId]);
    const configuration = configurationResult.rows[0];
    if (configuration === undefined) {
      throw new EnginePersistenceInvariantError(
        "Tournament configuration was not found."
      );
    }

    return {
      tournament: mapTournamentSummary(tournament),
      configuration: mapConfiguration(configuration),
      pods: podsResult.rows.map(mapPod),
      teams: teamsResult.rows.map((team) => ({
        id: parseStableUuid(team.id, "tournament_team"),
        publicKey: team.public_key,
        name: team.name,
        normalizedName: team.normalized_name,
        sequence: team.sequence,
        podId: parseStableUuid(team.pod_id, "pod"),
        initialSeed: team.initial_seed,
        players: playersResult.rows
          .filter((player) => player.team_id === team.id)
          .map(mapPlayer),
        metadata: team.metadata
      }))
    };
  }

  private async assertReplacementIdentityScope(
    executor: EnginePostgresExecutor,
    input: ReplaceTournamentDraftInput
  ): Promise<void> {
    const current = await this.readSetupRecord(executor, input.tournamentId);
    if (current === null) {
      throw new EnginePersistenceInvariantError("Tournament was not found.");
    }
    const expectedPods = new Map(current.pods.map((pod) => [pod.id, pod]));
    if (
      input.pods.length !== expectedPods.size ||
      input.pods.some((pod) => {
        const existing = expectedPods.get(pod.id);
        return existing === undefined ||
          existing.publicKey !== pod.publicKey ||
          existing.sequence !== pod.sequence;
      })
    ) {
      throw new EnginePersistenceInvariantError(
        "Draft replacement must preserve the configured pod identities."
      );
    }

    const currentTeams = new Map(current.teams.map((team) => [team.id, team]));
    const currentPlayers = new Map(current.teams.flatMap((team) =>
      team.players.map((player) => [player.id, player] as const)
    ));
    const currentMemberships = new Map(current.teams.flatMap((team) =>
      team.players.map((player) => [player.membershipId, player] as const)
    ));
    for (const team of input.teams) {
      const existingTeam = currentTeams.get(team.id);
      if (existingTeam !== undefined && existingTeam.publicKey !== team.publicKey) {
        throw new EnginePersistenceInvariantError(
          "Existing team public identities must be preserved."
        );
      }
      for (const player of team.players) {
        const existingPlayer = currentPlayers.get(player.id);
        const existingMembership = currentMemberships.get(player.membershipId);
        if (
          existingPlayer !== undefined &&
            existingPlayer.publicKey !== player.publicKey ||
          existingMembership !== undefined &&
            existingMembership.membershipPublicKey !== player.membershipPublicKey
        ) {
          throw new EnginePersistenceInvariantError(
            "Existing player and roster identities must be preserved."
          );
        }
      }
    }

    const identities = [
      ...input.teams.map((team) => team.id),
      ...input.teams.flatMap((team) => team.players.map((player) => player.id)),
      ...input.teams.flatMap((team) =>
        team.players.map((player) => player.membershipId)
      )
    ];
    const foreign = await executor.query<{ found: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM engine_teams
        WHERE id = ANY($2::uuid[]) AND tournament_id <> $1::uuid
        UNION ALL
        SELECT 1 FROM engine_players
        WHERE id = ANY($2::uuid[]) AND tournament_id <> $1::uuid
        UNION ALL
        SELECT 1 FROM engine_roster_memberships
        WHERE id = ANY($2::uuid[]) AND tournament_id <> $1::uuid
      ) AS found
    `, [input.tournamentId, identities]);
    if (foreign.rows[0]?.found === true) {
      throw new EnginePersistenceInvariantError(
        "Draft replacement identities belong to another tournament."
      );
    }
  }

  private async replacePods(
    executor: EnginePostgresExecutor,
    input: ReplaceTournamentDraftInput
  ): Promise<void> {
    for (const pod of input.pods) {
      const result = await executor.query(`
        UPDATE engine_pods
        SET name = $3, normalized_name = $4, metadata = $5::jsonb
        WHERE tournament_id = $1::uuid AND id = $2::uuid
      `, [
        input.tournamentId,
        pod.id,
        pod.name,
        pod.normalizedName,
        writeEngineJson(pod.metadata ?? {})
      ]);
      if (result.rowCount !== 1) {
        throw new EnginePersistenceInvariantError(
          "Draft replacement referenced an unknown pod."
        );
      }
    }
  }
}

function mapTournamentSummary(
  row: TournamentSummaryRow
): AdminTournamentSummaryRecord {
  return {
    tournamentId: parseStableUuid(row.id, "tournament"),
    publicKey: row.public_key,
    gameType: row.game_type,
    year: row.year,
    name: row.name,
    lifecycle: row.lifecycle,
    visibility: row.visibility,
    rowVersion: Number(row.row_version),
    setupPublishedAt: toIsoString(row.setup_published_at),
    createdAt: requireIsoString(row.created_at),
    updatedAt: requireIsoString(row.updated_at)
  };
}

function mapConfiguration(row: ConfigurationRow): CopiedTournamentConfiguration {
  return copyTournamentConfiguration({
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
      row.standings_rules as unknown as CopiedTournamentConfiguration["standingsRules"]
  }, row.copied_from_preset_id ?? undefined);
}

function mapPod(row: StoredPodRow): DraftPodInput {
  return {
    id: parseStableUuid(row.id, "pod"),
    publicKey: row.public_key,
    name: row.name,
    normalizedName: row.normalized_name,
    sequence: row.sequence,
    metadata: row.metadata
  };
}

function mapPlayer(row: StoredPlayerRow) {
  return {
    id: parseStableUuid(row.id, "tournament_player"),
    publicKey: row.public_key,
    displayName: row.display_name,
    ...(row.first_name === null ? {} : { firstName: row.first_name }),
    ...(row.last_name === null ? {} : { lastName: row.last_name }),
    ...(row.preferred_name === null
      ? {}
      : { preferredName: row.preferred_name }),
    membershipId: parseStableUuid(row.membership_id, "roster_membership"),
    membershipPublicKey: row.membership_public_key,
    rosterSlot: row.roster_slot,
    metadata: row.metadata
  };
}

function toTournamentSetup(record: AdminTournamentSetupRecord): TournamentSetup {
  return {
    tournamentId: record.tournament.tournamentId,
    teams: record.teams.map((team) => ({
      id: team.id,
      name: team.name,
      playerIds: team.players.map((player) => player.id)
    })),
    pods: record.pods.map((pod) => ({
      id: pod.id,
      name: pod.name,
      sequence: pod.sequence,
      teamAssignments: record.teams
        .filter((team) => team.podId === pod.id)
        .sort((first, second) => first.initialSeed - second.initialSeed)
        .map((team) => ({
          teamId: team.id,
          initialSeed: team.initialSeed
        }))
    }))
  };
}

function toIsoString(value: Date | string | null): string | null {
  return value === null ? null : requireIsoString(value);
}

function requireIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new EnginePersistenceInvariantError(
      "Tournament timestamp could not be read."
    );
  }
  return date.toISOString();
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
