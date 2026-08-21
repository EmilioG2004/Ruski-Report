import { createHash } from "node:crypto";

import { PostgresDatabase } from "../../../database";
import { TransactionContext } from "../../../repositories/transaction";
import {
  copyTournamentConfiguration,
  OFFICIAL_STANDINGS_RULES,
  POD_AND_SINGLE_ELIMINATION_FORMAT,
  TOURNAMENT_FORMAT_VERSION
} from "../../configuration";
import { isStableUuid, parseStableUuid, TournamentId } from "../../domain";
import {
  EnginePersistenceConflictError,
  EnginePersistenceInvariantError,
  EngineWriterLeaseConflictError
} from "../../persistence/errors";
import { PostgresCanonicalStatisticRepository } from "../../persistence/postgres-canonical-statistic.repository";
import { PostgresTournamentProgressionRepository } from "../../persistence/postgres-tournament-progression.repository";
import {
  engineExecutor,
  EnginePostgresExecutor,
  lockEngineMatch,
  lockEngineTournament,
  writeEngineAuditEvent,
  writeEngineJson
} from "../../persistence/postgres-engine-executor";
import {
  assertEngineWriterFence,
  PostgresMatchWriterRepository
} from "../../persistence/postgres-match-writer.repository";
import { PostgresMatchRevisionRepository } from "../../persistence/postgres-match-revision.repository";
import { TournamentEngineTransactionManager } from "../../persistence/engine-transaction.manager";
import {
  CanonicalProjectionActivationResult,
  PostgresProjectionRepository
} from "../../persistence/postgres-projection.repository";
import {
  CanonicalProjectionActivationListener,
  notifyCanonicalProjectionActivation,
  refreshCanonicalProjectionInTransaction
} from "../../persistence/projection-refresh";
import { createUuidV5 } from "../../scheduling/uuid-v5";
import {
  materializeWorkbookCandidate,
  RUSKI_CANONICAL_SCORING_RULES_VERSION
} from "../../scoring";
import type { CanonicalWorkbookSourceRow } from "../generation";
import {
  ConfirmWorkbookImportInput,
  CreateWorkbookImportPreviewInput,
  digestWorkbookParticipants,
  digestWorkbookValue,
  GeneratedWorkbookArtifactRecord,
  GeneratedWorkbookManifestSheetRecord,
  GeneratedWorkbookSheetInput,
  GeneratedWorkbookSummaryRecord,
  ReviseWorkbookImportPreviewInput,
  StoreGeneratedWorkbookInput,
  StoreGeneratedWorkbookResult,
  WorkbookGenerationSourceMatchRecord,
  WorkbookGenerationSourceMatchTeamRecord,
  WorkbookGenerationSourcePlayerRecord,
  WorkbookGenerationSourceRecord,
  WorkbookGenerationSourceTeamRecord,
  WorkbookImportConfirmationResult,
  WorkbookImportObservationInput,
  WorkbookImportObservationRecord,
  WorkbookImportPreviewRecord,
  WorkbookObservationValidationIssue,
  WorkbookRevisionCandidateInput
} from "./contracts";

const PREVIEW_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1_000;
const WRITER_LEASE_MILLISECONDS = 5 * 60 * 1_000;
const SHA256 = /^[a-f0-9]{64}$/;

interface GenerationTournamentRow {
  id: string;
  public_key: string;
  year: number;
  name: string;
  lifecycle: WorkbookGenerationSourceRecord["tournament"]["lifecycle"];
  row_version: string | number;
  setup_published_at: Date | string | null;
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

interface GenerationPodRow {
  id: string;
  name: string;
  sequence: number;
}

interface GenerationTeamRow {
  id: string;
  name: string;
  sequence: number;
  pod_id: string;
  initial_seed: number;
}

interface GenerationPlayerRow {
  team_id: string;
  player_id: string;
  membership_id: string;
  roster_slot: number;
  display_name: string;
}

interface GenerationMatchRow {
  id: string;
  stage: "pod_play" | "playoffs";
  pod_id: string | null;
  sequence: number;
  row_version: string | number;
  status: WorkbookGenerationSourceMatchRecord["status"];
  score_availability: WorkbookGenerationSourceMatchRecord["scoreAvailability"];
  metadata: Record<string, unknown>;
  active_revision_id: string | null;
  side_one_team_id: string | null;
  side_two_team_id: string | null;
  source_state_version: string | number | null;
  active_candidate_id: string | null;
  active_fingerprint: string | null;
  participant_digest: string | null;
  source_revision_number: string | number | null;
  proposed_status: WorkbookGenerationSourceMatchRecord["status"] | null;
  active_candidate_envelope: Record<string, unknown> | null;
  bracket_match_id: string | null;
  bracket_round_number: number | null;
  sequence_in_round: string | number | null;
}

interface GeneratedWorkbookRow {
  id: string;
  tournament_id: string;
  generation_revision: string | number;
  workbook_schema_version: number;
  generation_kind: "setup" | "playoffs_cumulative";
  source_tournament_row_version: string | number;
  source_digest: string;
  artifact_digest: string;
  artifact_size_bytes: string | number;
  artifact: Buffer;
  filename: string;
  generated_by_admin_id: string;
  generated_at: Date | string;
}

type GeneratedWorkbookSummaryRow = Omit<GeneratedWorkbookRow, "artifact"> & {
  sheet_count: string | number;
};

interface GeneratedSheetRow {
  sheet_id: string;
  sheet_ordinal: number;
  sheet_kind: "control" | "blank" | "game";
  sheet_name: string;
  match_id: string | null;
  generated_match_row_version: string | number | null;
  side_one_team_id: string | null;
  side_two_team_id: string | null;
  participant_digest: string | null;
  baseline_fingerprint: string | null;
}

interface ImportBatchRow {
  id: string;
  tournament_id: string;
  workbook_id: string;
  supersedes_batch_id: string | null;
  workbook_schema_version: number;
  source_workbook_digest: string;
  source_size_bytes: string | number;
  base_tournament_row_version: string | number;
  preview_digest: string;
  status: WorkbookImportPreviewRecord["status"];
  recognized_sheet_count: number;
  proposed_sheet_count: number;
  unchanged_sheet_count: number;
  missing_sheet_count: number;
  invalid_sheet_count: number;
  received_by_admin_id: string;
  received_at: Date | string;
  previewed_at: Date | string;
  preview_expires_at: Date | string;
  confirmed_by_admin_id: string | null;
  confirmed_at: Date | string | null;
  completed_at: Date | string | null;
}

interface ImportObservationRow {
  id: string;
  batch_id: string;
  observation_kind: "present" | "missing";
  sheet_ordinal: number | null;
  workbook_sheet_id: string | null;
  match_id: string | null;
  assignment_source: WorkbookImportObservationRecord["assignmentSource"];
  disposition: WorkbookImportObservationRecord["disposition"];
  fingerprint: string | null;
  base_match_row_version: string | number | null;
  base_source_state_version: string | number;
  source_envelope_schema_version: number | null;
  source_envelope_digest: string | null;
  source_envelope: Record<string, unknown> | null;
  validation_issues: WorkbookObservationValidationIssue[];
  candidate_id: string | null;
  previous_applied_candidate_id: string | null;
  source_revision_number: string | number | null;
  candidate_fingerprint: string | null;
  participant_digest: string | null;
  proposed_status: WorkbookRevisionCandidateInput["proposedStatus"] | null;
  proposed_score_availability:
    WorkbookRevisionCandidateInput["proposedScoreAvailability"] | null;
  reason: WorkbookRevisionCandidateInput["reason"] | null;
  requires_confirmation: boolean | null;
  envelope_schema_version: number | null;
  envelope_digest: string | null;
  envelope: Record<string, unknown> | null;
  candidate_base_match_row_version: string | number | null;
  candidate_base_source_state_version: string | number | null;
}

interface AcceptedCandidateReplayRow {
  candidate_id: string;
  batch_id: string;
  observation_id: string;
  previous_applied_candidate_id: string | null;
  administrator_id: string;
  reason: string | null;
  decided_at: Date | string;
  materialized_revision_id: string | null;
}

interface CandidateMaterializationContext {
  candidate: WorkbookRevisionCandidateInput;
  batchId: string;
  observationId: string;
  actorId: string;
  createdAt: string;
  confirmationDigest: string;
  correctionReason?: string;
  replayedPhaseThreeSource: boolean;
}

interface CandidateTeamRow {
  candidate_id: string;
  side_number: 1 | 2;
  team_id: string;
  display_name_at_import: string;
}

interface CandidatePlayerRow {
  candidate_id: string;
  side_number: 1 | 2;
  team_id: string;
  player_id: string;
  roster_membership_id: string;
  roster_slot: number;
  display_name_at_import: string;
}

interface RevisionTeamRow {
  revision_id: string;
  side_number: 1 | 2;
  team_id: string;
  display_name_at_revision: string;
  score: number | null;
  result: "pending" | "win" | "loss" | "tie" | "cancelled" | "forfeited";
}

interface RevisionPlayerRow {
  revision_id: string;
  side_number: 1 | 2;
  team_id: string;
  player_id: string;
  roster_membership_id: string;
  roster_slot: number;
  display_name_at_revision: string;
}

export class PostgresWorkbookReconciliationRepository {
  private readonly transactions: TournamentEngineTransactionManager;
  private readonly writers: PostgresMatchWriterRepository;
  private readonly revisions: PostgresMatchRevisionRepository;
  private readonly statistics: PostgresCanonicalStatisticRepository;
  private readonly progression: PostgresTournamentProgressionRepository;

  constructor(
    private readonly database: PostgresDatabase,
    transactions?: TournamentEngineTransactionManager,
    writers?: PostgresMatchWriterRepository,
    revisions?: PostgresMatchRevisionRepository,
    statistics?: PostgresCanonicalStatisticRepository,
    progression?: PostgresTournamentProgressionRepository,
    private readonly projections?: PostgresProjectionRepository,
    private readonly projectionListener?: CanonicalProjectionActivationListener
  ) {
    this.transactions = transactions ?? new TournamentEngineTransactionManager(database);
    this.writers = writers ?? new PostgresMatchWriterRepository(
      database,
      this.transactions
    );
    this.revisions = revisions ?? new PostgresMatchRevisionRepository(
      database,
      this.transactions
    );
    this.statistics = statistics ?? new PostgresCanonicalStatisticRepository(
      database
    );
    this.progression = progression ?? new PostgresTournamentProgressionRepository(
      database,
      this.transactions
    );
  }

  readGenerationSource(
    tournamentId: TournamentId
  ): Promise<WorkbookGenerationSourceRecord | null> {
    return this.transactions.run(
      (transaction) => this.readGenerationSourceInTransaction(
        tournamentId,
        transaction
      ),
      { isolationLevel: "repeatable read", readOnly: true }
    );
  }

  storeGeneratedWorkbook(
    input: StoreGeneratedWorkbookInput
  ): Promise<StoreGeneratedWorkbookResult> {
    validateGeneratedWorkbookInput(input);
    return this.transactions.run((transaction) =>
      this.storeGeneratedWorkbookInTransaction(input, transaction)
    );
  }

  findGeneratedWorkbookArtifact(
    tournamentId: TournamentId,
    workbookId: string
  ): Promise<GeneratedWorkbookArtifactRecord | null> {
    return this.transactions.run(
      (transaction) => this.findGeneratedWorkbookArtifactInTransaction(
        engineExecutor(this.database, transaction),
        tournamentId,
        workbookId
      ),
      { isolationLevel: "repeatable read", readOnly: true }
    );
  }

  listGeneratedWorkbooks(
    tournamentId: TournamentId
  ): Promise<readonly GeneratedWorkbookSummaryRecord[]> {
    return this.transactions.run(async (transaction) => {
      const executor = engineExecutor(this.database, transaction);
      const result = await executor.query<GeneratedWorkbookSummaryRow>(
        `
          SELECT workbook.id::text, workbook.tournament_id::text,
                 workbook.generation_revision,
                 workbook.workbook_schema_version, workbook.generation_kind,
                 workbook.source_tournament_row_version,
                 workbook.source_digest, workbook.artifact_digest,
                 workbook.artifact_size_bytes,
                 workbook.filename,
                 workbook.generated_by_admin_id::text,
                 workbook.generated_at,
                 count(sheet.sheet_id) AS sheet_count
          FROM engine_generated_workbooks workbook
          LEFT JOIN engine_generated_workbook_sheets sheet
            ON sheet.workbook_id = workbook.id
          WHERE workbook.tournament_id = $1::uuid
          GROUP BY workbook.id
          ORDER BY workbook.generation_revision DESC, workbook.generated_at DESC
        `,
        [tournamentId]
      );
      return result.rows.map((row) => ({
        workbookId: row.id,
        tournamentId: row.tournament_id as TournamentId,
        generationRevision: Number(row.generation_revision),
        workbookSchemaVersion: row.workbook_schema_version,
        generationKind: row.generation_kind,
        sourceTournamentRowVersion: Number(row.source_tournament_row_version),
        sourceDigest: row.source_digest,
        artifactDigest: row.artifact_digest,
        artifactSizeBytes: Number(row.artifact_size_bytes),
        filename: row.filename,
        generatedByAdminId: row.generated_by_admin_id,
        generatedAt: toIso(row.generated_at),
        sheetCount: Number(row.sheet_count)
      }));
    }, { isolationLevel: "repeatable read", readOnly: true });
  }

  async readGenerationSourceInTransaction(
    tournamentId: TournamentId,
    transaction: TransactionContext
  ): Promise<WorkbookGenerationSourceRecord | null> {
    const executor = engineExecutor(this.database, transaction);
    const tournamentResult = await executor.query<GenerationTournamentRow>(
      `
        SELECT id::text, public_key, year, name, lifecycle, row_version,
               setup_published_at
        FROM engine_tournaments
        WHERE id = $1::uuid
      `,
      [tournamentId]
    );
    const tournament = tournamentResult.rows[0];
    if (tournament === undefined) {
      return null;
    }
    if (tournament.lifecycle === "draft_setup" ||
        tournament.setup_published_at === null) {
      throw new EnginePersistenceConflictError(
        "A canonical workbook requires published tournament setup."
      );
    }

    const configurationResult = await executor.query<ConfigurationRow>(`
          SELECT format_version, format_type, team_count, pod_count, pod_sizes,
                 players_per_team, games_per_pair, qualifiers_per_pod,
                 bracket_size, allow_byes, standings_rules,
                 copied_from_preset_id
          FROM engine_tournament_configurations
          WHERE tournament_id = $1::uuid
        `, [tournamentId]);
    const podResult = await executor.query<GenerationPodRow>(`
          SELECT id::text, name, sequence
          FROM engine_pods
          WHERE tournament_id = $1::uuid
          ORDER BY sequence
        `, [tournamentId]);
    const teamResult = await executor.query<GenerationTeamRow>(`
          SELECT team.id::text, team.name, team.sequence,
                 assignment.pod_id::text, assignment.initial_seed
          FROM engine_teams team
          JOIN engine_pod_teams assignment
            ON assignment.tournament_id = team.tournament_id
           AND assignment.team_id = team.id
          WHERE team.tournament_id = $1::uuid
          ORDER BY team.sequence
        `, [tournamentId]);
    const playerResult = await executor.query<GenerationPlayerRow>(`
          SELECT membership.team_id::text, player.id::text AS player_id,
                 membership.id::text AS membership_id,
                 membership.roster_slot, player.display_name
          FROM engine_roster_memberships membership
          JOIN engine_players player
            ON player.tournament_id = membership.tournament_id
           AND player.id = membership.player_id
          WHERE membership.tournament_id = $1::uuid
            AND membership.closed_at IS NULL
          ORDER BY membership.team_id, membership.roster_slot
        `, [tournamentId]);
    const matchResult = await executor.query<GenerationMatchRow>(`
          SELECT match.id::text, match.stage, match.pod_id::text,
                 match.sequence, match.row_version, match.status,
                 match.score_availability, match.metadata,
                 match.active_revision_id::text,
                 side_one.team_id::text AS side_one_team_id,
                 side_two.team_id::text AS side_two_team_id,
                 state.row_version AS source_state_version,
                 state.active_candidate_id::text,
                 state.active_fingerprint, state.participant_digest,
                 active_candidate.source_revision_number,
                 active_candidate.proposed_status,
                 active_candidate.envelope AS active_candidate_envelope,
                 bracket_match.id::text AS bracket_match_id,
                 bracket_round.sequence AS bracket_round_number,
                 row_number() OVER (
                   PARTITION BY bracket_round.id
                   ORDER BY bracket_match.sequence
                 ) AS sequence_in_round
          FROM engine_matches match
          LEFT JOIN engine_match_slots side_one
            ON side_one.match_id = match.id AND side_one.slot_number = 1
          LEFT JOIN engine_match_slots side_two
            ON side_two.match_id = match.id AND side_two.slot_number = 2
          LEFT JOIN engine_match_workbook_source_states state
            ON state.tournament_id = match.tournament_id
           AND state.match_id = match.id
          LEFT JOIN engine_workbook_revision_candidates active_candidate
            ON active_candidate.id = state.active_candidate_id
          LEFT JOIN engine_bracket_matches bracket_match
            ON bracket_match.tournament_id = match.tournament_id
           AND bracket_match.match_id = match.id
          LEFT JOIN engine_bracket_rounds bracket_round
            ON bracket_round.tournament_id = bracket_match.tournament_id
           AND bracket_round.id = bracket_match.round_id
          WHERE match.tournament_id = $1::uuid
            AND NOT match.identity_only
            AND (
              match.stage = 'pod_play'
              OR (bracket_match.id IS NOT NULL AND bracket_match.playable)
            )
          ORDER BY match.stage, match.sequence
        `, [tournamentId]);
    const activeCandidateIds = matchResult.rows.flatMap((match) =>
      match.active_candidate_id === null ? [] : [match.active_candidate_id]
    );
    const activeRevisionIds = matchResult.rows.flatMap((match) =>
      match.active_revision_id === null ? [] : [match.active_revision_id]
    );
    let activeTeamRows: CandidateTeamRow[] = [];
    let activePlayerRows: CandidatePlayerRow[] = [];
    if (activeCandidateIds.length > 0) {
      activeTeamRows = (await executor.query<CandidateTeamRow>(`
        SELECT candidate_id::text, side_number, team_id::text,
               display_name_at_import
        FROM engine_workbook_revision_candidate_teams
        WHERE candidate_id = ANY($1::uuid[])
        ORDER BY candidate_id, side_number
      `, [activeCandidateIds])).rows;
      activePlayerRows = (await executor.query<CandidatePlayerRow>(`
        SELECT candidate_id::text, side_number, team_id::text,
               player_id::text, roster_membership_id::text,
               roster_slot, display_name_at_import
        FROM engine_workbook_revision_candidate_players
        WHERE candidate_id = ANY($1::uuid[])
        ORDER BY candidate_id, side_number, roster_slot
      `, [activeCandidateIds])).rows;
    }
    let activeRevisionTeamRows: RevisionTeamRow[] = [];
    let activeRevisionPlayerRows: RevisionPlayerRow[] = [];
    if (activeRevisionIds.length > 0) {
      activeRevisionTeamRows = (await executor.query<RevisionTeamRow>(`
        SELECT revision_id::text, side_number, team_id::text,
               display_name_at_revision, score, result
        FROM engine_match_revision_teams
        WHERE revision_id = ANY($1::uuid[])
        ORDER BY revision_id, side_number
      `, [activeRevisionIds])).rows;
      activeRevisionPlayerRows = (await executor.query<RevisionPlayerRow>(`
        SELECT revision_id::text, side_number, team_id::text,
               player_id::text, roster_membership_id::text,
               roster_slot, display_name_at_revision
        FROM engine_match_revision_players
        WHERE revision_id = ANY($1::uuid[])
        ORDER BY revision_id, side_number, roster_slot
      `, [activeRevisionIds])).rows;
    }
    const generationResult = await executor.query<{
      next_revision: string | number;
    }>(`
          SELECT COALESCE(max(generation_revision), 0) + 1 AS next_revision
          FROM engine_generated_workbooks
          WHERE tournament_id = $1::uuid
        `, [tournamentId]);
    const configuration = configurationResult.rows[0];
    if (configuration === undefined) {
      throw new EnginePersistenceInvariantError(
        "Tournament configuration was not found."
      );
    }

    const teams: WorkbookGenerationSourceTeamRecord[] = teamResult.rows.map(
      (team) => ({
        teamId: team.id,
        name: team.name,
        sequence: team.sequence,
        podId: team.pod_id,
        initialSeed: team.initial_seed,
        players: playerResult.rows
          .filter((player) => player.team_id === team.id)
          .map(mapGenerationPlayer)
      })
    );
    const teamById = new Map(teams.map((team) => [team.teamId, team]));
    const matches = matchResult.rows.map((match) => mapGenerationMatch(
      match,
      teamById,
      activeTeamRows,
      activePlayerRows,
      activeRevisionTeamRows,
      activeRevisionPlayerRows
    ));

    return {
      nextGenerationRevision: Number(
        generationResult.rows[0]?.next_revision ?? 1
      ),
      tournament: {
        tournamentId,
        publicKey: tournament.public_key,
        year: tournament.year,
        name: tournament.name,
        lifecycle: tournament.lifecycle,
        rowVersion: Number(tournament.row_version),
        setupPublishedAt: toIso(tournament.setup_published_at)
      },
      configuration: mapConfiguration(configuration),
      pods: podResult.rows.map((pod) => ({
        podId: pod.id,
        name: pod.name,
        sequence: pod.sequence
      })),
      teams,
      matches
    };
  }

  async storeGeneratedWorkbookInTransaction(
    input: StoreGeneratedWorkbookInput,
    transaction: TransactionContext
  ): Promise<StoreGeneratedWorkbookResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    await this.assertPublishedTournamentVersion(
      executor,
      input.tournamentId,
      input.sourceTournamentRowVersion
    );
    const existing = await executor.query<{ id: string }>(
      `
        SELECT id::text
        FROM engine_generated_workbooks
        WHERE tournament_id = $1::uuid
          AND workbook_schema_version = $2
          AND source_digest = $3
        FOR UPDATE
      `,
      [input.tournamentId, input.workbookSchemaVersion, input.sourceDigest]
    );
    const existingId = existing.rows[0]?.id;
    if (existingId !== undefined) {
      const workbook = await this.findGeneratedWorkbookArtifactInTransaction(
        executor,
        input.tournamentId,
        existingId
      );
      if (workbook === null) {
        throw new EnginePersistenceInvariantError(
          "Stored generated workbook could not be reloaded."
        );
      }
      return { created: false, workbook };
    }

    const revision = await executor.query<{ generation_revision: string | number }>(
      `
        SELECT COALESCE(max(generation_revision), 0) + 1 AS generation_revision
        FROM engine_generated_workbooks
        WHERE tournament_id = $1::uuid
      `,
      [input.tournamentId]
    );
    const nextGenerationRevision = Number(
      revision.rows[0]?.generation_revision ?? 1
    );
    if (input.generationRevision !== nextGenerationRevision) {
      throw new EnginePersistenceConflictError(
        "Workbook generation revision is stale; regenerate from current source."
      );
    }
    await executor.query(
      `
        INSERT INTO engine_generated_workbooks (
          id, tournament_id, generation_revision, workbook_schema_version,
          generation_kind, source_tournament_row_version, source_digest,
          artifact_digest, artifact_size_bytes, artifact, filename,
          generated_by_admin_id, generated_at
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4,
          $5, $6, $7,
          $8, $9, $10, $11,
          $12::uuid, $13
        )
      `,
      [
        input.workbookId,
        input.tournamentId,
        input.generationRevision,
        input.workbookSchemaVersion,
        input.generationKind,
        input.sourceTournamentRowVersion,
        input.sourceDigest,
        input.artifactDigest,
        input.artifact.byteLength,
        input.artifact,
        input.filename,
        input.generatedByAdminId,
        input.generatedAt
      ]
    );
    for (const sheet of input.sheets) {
      await this.insertGeneratedSheet(executor, input, sheet);
    }
    await writeEngineAuditEvent(executor, input.tournamentId, {
      eventId: input.audit.eventId,
      commandType: "canonical_workbook_generated",
      actor: { kind: "administrator", id: input.generatedByAdminId },
      occurredAt: input.generatedAt,
      correlationId: input.audit.correlationId,
      causationId: input.audit.causationId,
      details: {
        workbookId: input.workbookId,
        generationRevision: input.generationRevision,
        workbookSchemaVersion: input.workbookSchemaVersion,
        sourceDigest: input.sourceDigest,
        artifactDigest: input.artifactDigest,
        artifactSizeBytes: input.artifact.byteLength,
        sheetCount: input.sheets.length
      }
    });
    const workbook = await this.findGeneratedWorkbookArtifactInTransaction(
      executor,
      input.tournamentId,
      input.workbookId
    );
    if (workbook === null) {
      throw new EnginePersistenceInvariantError(
        "Generated workbook could not be reloaded."
      );
    }
    return { created: true, workbook };
  }

  createImportPreview(
    input: CreateWorkbookImportPreviewInput
  ): Promise<WorkbookImportPreviewRecord> {
    validatePreviewInput(input);
    return this.transactions.run(async (transaction) => {
      const executor = engineExecutor(this.database, transaction);
      await lockEngineTournament(executor, input.tournamentId);
      await this.insertImportPreview(executor, input, null);
      await this.writePreviewAudit(
        executor,
        input.tournamentId,
        input.receivedByAdminId,
        input.batchId,
        input.previewDigest,
        input.observations,
        input.status === "preview_ready"
          ? "workbook_import_preview_created"
          : "workbook_import_preview_rejected",
        input.previewedAt,
        input.audit
      );
      const stored = await this.findImportPreviewInTransaction(
        executor,
        input.tournamentId,
        input.batchId
      );
      if (stored === null) {
        throw new EnginePersistenceInvariantError(
          "Workbook import preview could not be reloaded."
        );
      }
      return stored;
    });
  }

  reviseImportPreview(
    input: ReviseWorkbookImportPreviewInput
  ): Promise<WorkbookImportPreviewRecord> {
    validateRevisionInput(input);
    return this.transactions.run(async (transaction) => {
      const executor = engineExecutor(this.database, transaction);
      await lockEngineTournament(executor, input.tournamentId);
      const prior = await this.lockImportBatch(
        executor,
        input.tournamentId,
        input.supersedesBatchId
      );
      if (prior.status !== "preview_ready") {
        throw new EnginePersistenceConflictError(
          "Only an active workbook preview can be revised."
        );
      }
      const serverTime = await readServerTime(executor);
      if (Date.parse(serverTime) >= Date.parse(toIso(prior.preview_expires_at))) {
        throw new EnginePersistenceConflictError(
          "Workbook import preview has expired."
        );
      }
      const previousObservations = await this.readObservationRows(
        executor,
        input.tournamentId,
        input.supersedesBatchId
      );
      assertSameNormalizedSource(previousObservations, input.observations);

      const revised: CreateWorkbookImportPreviewInput = {
        batchId: input.batchId,
        tournamentId: input.tournamentId,
        workbookId: prior.workbook_id,
        workbookSchemaVersion: prior.workbook_schema_version,
        sourceWorkbookDigest: prior.source_workbook_digest,
        sourceSizeBytes: Number(prior.source_size_bytes),
        baseTournamentRowVersion: Number(prior.base_tournament_row_version),
        previewDigest: input.previewDigest,
        status: input.status,
        receivedByAdminId: prior.received_by_admin_id,
        receivedAt: toIso(prior.received_at),
        previewedAt: input.previewedAt,
        observations: input.observations,
        audit: input.audit
      };
      validatePreviewInput(revised);
      await this.insertImportPreview(
        executor,
        revised,
        input.supersedesBatchId
      );
      await executor.query(
        `
          UPDATE engine_workbook_import_batches
          SET status = 'superseded', completed_at = $3
          WHERE id = $1::uuid
            AND tournament_id = $2::uuid
            AND status = 'preview_ready'
        `,
        [input.supersedesBatchId, input.tournamentId, input.previewedAt]
      );
      await this.writePreviewAudit(
        executor,
        input.tournamentId,
        input.revisedByAdminId,
        input.batchId,
        input.previewDigest,
        input.observations,
        "workbook_import_preview_revised",
        input.previewedAt,
        input.audit
      );
      const stored = await this.findImportPreviewInTransaction(
        executor,
        input.tournamentId,
        input.batchId
      );
      if (stored === null) {
        throw new EnginePersistenceInvariantError(
          "Revised workbook import preview could not be reloaded."
        );
      }
      return stored;
    });
  }

  findImportPreview(
    tournamentId: TournamentId,
    batchId: string
  ): Promise<WorkbookImportPreviewRecord | null> {
    return this.transactions.run(
      (transaction) => this.findImportPreviewInTransaction(
        engineExecutor(this.database, transaction),
        tournamentId,
        batchId
      ),
      { isolationLevel: "repeatable read", readOnly: true }
    );
  }

  async confirmImport(
    input: ConfirmWorkbookImportInput
  ): Promise<WorkbookImportConfirmationResult> {
    validateDigest(input.previewDigest, "Preview digest");
    validateDigest(input.confirmationDigest, "Confirmation digest");
    assertUniqueIds(input.acceptedObservationIds, "Accepted observations");
    assertUniqueIds(input.skippedObservationIds, "Skipped observations");
    let projection: CanonicalProjectionActivationResult | undefined;
    const result = await this.transactions.run(async (transaction) => {
      const confirmation = await this.confirmImportInTransaction(
        input,
        transaction
      );
      if (confirmation.status === "applied") {
        const executor = engineExecutor(this.database, transaction);
        const tournament = await executor.query<{
          row_version: string | number;
        }>(`
          SELECT row_version
          FROM engine_tournaments
          WHERE id = $1::uuid
        `, [input.tournamentId]);
        const rowVersion = tournament.rows[0]?.row_version;
        if (rowVersion === undefined) {
          throw new EnginePersistenceInvariantError(
            "Tournament was not found after workbook confirmation."
          );
        }
        projection = await refreshCanonicalProjectionInTransaction(
          this.projections,
          {
            tournamentId: input.tournamentId,
            expectedTournamentRowVersion: Number(rowVersion),
            occurredAt: confirmation.completedAt,
            sourceCommandType: "workbook_import_applied",
            actor: {
              kind: "administrator",
              id: input.confirmedByAdminId
            },
            sourceEventId: input.audit.eventId,
            correlationId: input.audit.correlationId
          },
          transaction
        );
      }
      return confirmation;
    });
    notifyCanonicalProjectionActivation(this.projectionListener, projection);
    return result;
  }

  private async findGeneratedWorkbookArtifactInTransaction(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    workbookId: string
  ): Promise<GeneratedWorkbookArtifactRecord | null> {
    const result = await executor.query<GeneratedWorkbookRow>(
      `
        SELECT id::text, tournament_id::text, generation_revision,
               workbook_schema_version, generation_kind,
               source_tournament_row_version, source_digest, artifact_digest,
               artifact_size_bytes, artifact, filename,
               generated_by_admin_id::text, generated_at
        FROM engine_generated_workbooks
        WHERE id = $1::uuid AND tournament_id = $2::uuid
      `,
      [workbookId, tournamentId]
    );
    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }
    const sheets = await executor.query<GeneratedSheetRow>(
      `
        SELECT sheet_id::text, sheet_ordinal, sheet_kind, sheet_name,
               match_id::text, generated_match_row_version,
               side_one_team_id::text, side_two_team_id::text,
               participant_digest, baseline_fingerprint
        FROM engine_generated_workbook_sheets
        WHERE workbook_id = $1::uuid AND tournament_id = $2::uuid
        ORDER BY sheet_ordinal
      `,
      [workbookId, tournamentId]
    );
    return mapGeneratedWorkbook(row, sheets.rows);
  }

  private async insertGeneratedSheet(
    executor: EnginePostgresExecutor,
    workbook: StoreGeneratedWorkbookInput,
    sheet: GeneratedWorkbookSheetInput
  ): Promise<void> {
    if (sheet.sheetKind === "game") {
      const match = await executor.query<{
        row_version: string | number;
        side_one_team_id: string | null;
        side_two_team_id: string | null;
      }>(
        `
          SELECT match.row_version,
                 side_one.team_id::text AS side_one_team_id,
                 side_two.team_id::text AS side_two_team_id
          FROM engine_matches match
          LEFT JOIN engine_match_slots side_one
            ON side_one.match_id = match.id AND side_one.slot_number = 1
          LEFT JOIN engine_match_slots side_two
            ON side_two.match_id = match.id AND side_two.slot_number = 2
          WHERE match.tournament_id = $1::uuid AND match.id = $2::uuid
          FOR KEY SHARE OF match
        `,
        [workbook.tournamentId, sheet.matchId]
      );
      const stored = match.rows[0];
      if (stored === undefined ||
          Number(stored.row_version) !== sheet.generatedMatchRowVersion ||
          stored.side_one_team_id !== sheet.participantTeamIds[0] ||
          stored.side_two_team_id !== sheet.participantTeamIds[1]) {
        throw new EnginePersistenceConflictError(
          "Generated sheet participants or match version are stale."
        );
      }
    }
    await executor.query(
      `
        INSERT INTO engine_generated_workbook_sheets (
          workbook_id, tournament_id, sheet_id, sheet_ordinal, sheet_kind,
          sheet_name, match_id, generated_match_row_version,
          side_one_team_id, side_two_team_id, participant_digest,
          baseline_fingerprint
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5,
          $6, $7::uuid, $8,
          $9::uuid, $10::uuid, $11,
          $12
        )
      `,
      [
        workbook.workbookId,
        workbook.tournamentId,
        sheet.sheetId,
        sheet.sheetOrdinal,
        sheet.sheetKind,
        sheet.sheetName,
        sheet.sheetKind === "game" ? sheet.matchId : null,
        sheet.sheetKind === "game" ? sheet.generatedMatchRowVersion : null,
        sheet.sheetKind === "game" ? sheet.participantTeamIds[0] : null,
        sheet.sheetKind === "game" ? sheet.participantTeamIds[1] : null,
        sheet.sheetKind === "game" ? sheet.participantDigest : null,
        sheet.baselineFingerprint
      ]
    );
  }

  private async insertImportPreview(
    executor: EnginePostgresExecutor,
    input: CreateWorkbookImportPreviewInput,
    supersedesBatchId: string | null
  ): Promise<void> {
    await this.assertPublishedTournamentVersion(
      executor,
      input.tournamentId,
      input.baseTournamentRowVersion
    );
    const workbook = await executor.query<{
      workbook_schema_version: number;
    }>(
      `
        SELECT workbook_schema_version
        FROM engine_generated_workbooks
        WHERE id = $1::uuid AND tournament_id = $2::uuid
        FOR KEY SHARE
      `,
      [input.workbookId, input.tournamentId]
    );
    if (workbook.rows[0]?.workbook_schema_version !== input.workbookSchemaVersion) {
      throw new EnginePersistenceInvariantError(
        "Workbook schema does not match its stored generation."
      );
    }
    const counts = observationCounts(input.observations);
    const previewExpiresAt = new Date(
      Date.parse(input.previewedAt) + PREVIEW_LIFETIME_MILLISECONDS
    ).toISOString();
    await executor.query(
      `
        INSERT INTO engine_workbook_import_batches (
          id, tournament_id, workbook_id, workbook_schema_version,
          source_workbook_digest, source_size_bytes,
          base_tournament_row_version, preview_digest, status,
          supersedes_batch_id, recognized_sheet_count, proposed_sheet_count,
          unchanged_sheet_count, missing_sheet_count, invalid_sheet_count,
          received_by_admin_id, received_at, previewed_at, preview_expires_at,
          completed_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4,
          $5, $6,
          $7, $8, $9,
          $10::uuid, $11, $12,
          $13, $14, $15,
          $16::uuid, $17, $18, $19,
          $20
        )
      `,
      [
        input.batchId,
        input.tournamentId,
        input.workbookId,
        input.workbookSchemaVersion,
        input.sourceWorkbookDigest,
        input.sourceSizeBytes,
        input.baseTournamentRowVersion,
        input.previewDigest,
        input.status,
        supersedesBatchId,
        counts.recognized,
        counts.proposed,
        counts.unchanged,
        counts.missing,
        counts.invalid,
        input.receivedByAdminId,
        input.receivedAt,
        input.previewedAt,
        previewExpiresAt,
        input.status === "preview_rejected" ? input.previewedAt : null
      ]
    );

    const sorted = [...input.observations].sort(compareObservations);
    for (const observation of sorted) {
      await this.assertObservationBase(executor, input, observation);
      const observationId = scopedId(
        input.batchId,
        "observation",
        observation.observationId
      );
      await executor.query(
        `
          INSERT INTO engine_workbook_import_observations (
            id, tournament_id, batch_id, workbook_id, workbook_sheet_id,
            sheet_ordinal, match_id, observation_kind, assignment_source,
            disposition, fingerprint, base_match_row_version,
            base_source_state_version, source_envelope_schema_version,
            source_envelope_digest, source_envelope, validation_issues,
            observed_at
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
            $6, $7::uuid, $8, $9,
            $10, $11, $12,
            $13, $14,
            $15, $16::jsonb, $17::jsonb, $18
          )
        `,
        [
          observationId,
          input.tournamentId,
          input.batchId,
          input.workbookId,
          observation.workbookSheetId ?? null,
          observation.observationKind === "present"
            ? observation.sheetOrdinal
            : null,
          observation.matchId ?? null,
          observation.observationKind,
          observation.assignmentSource,
          observation.disposition,
          observation.observationKind === "present"
            ? observation.fingerprint ?? null
            : null,
          observation.baseMatchRowVersion ?? null,
          observation.baseSourceStateVersion,
          observation.observationKind === "present"
            ? observation.sourceEnvelopeSchemaVersion
            : null,
          observation.observationKind === "present"
            ? observation.sourceEnvelopeDigest
            : null,
          observation.observationKind === "present"
            ? writeEngineJson(observation.sourceEnvelope)
            : null,
          writeEngineJson(observation.validationIssues),
          input.previewedAt
        ]
      );
      if (observation.observationKind === "present" &&
          observation.candidate !== undefined) {
        await this.insertCandidate(
          executor,
          input,
          observation,
          observationId
        );
      }
    }
  }

  private async insertCandidate(
    executor: EnginePostgresExecutor,
    input: CreateWorkbookImportPreviewInput,
    observation: Extract<WorkbookImportObservationInput, {
      observationKind: "present";
    }>,
    observationId: string
  ): Promise<void> {
    const candidate = observation.candidate;
    if (candidate === undefined || observation.matchId === undefined ||
        observation.fingerprint === undefined ||
        observation.baseMatchRowVersion === undefined) {
      throw new EnginePersistenceInvariantError(
        "A proposed workbook observation requires a complete candidate."
      );
    }
    validateCandidate(candidate, observation);
    await this.assertCandidateTeamsMatchSlots(
      executor,
      input.tournamentId,
      observation.matchId,
      candidate
    );
    const candidateId = scopedId(
      input.batchId,
      observationId,
      candidate.candidateId
    );
    await executor.query(
      `
        INSERT INTO engine_workbook_revision_candidates (
          id, tournament_id, match_id, batch_id, observation_id,
          previous_applied_candidate_id, source_revision_number, fingerprint,
          participant_digest, proposed_status, proposed_score_availability,
          reason, requires_confirmation, envelope_schema_version,
          envelope_digest, envelope, base_match_row_version,
          base_source_state_version, created_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
          $6::uuid, $7, $8,
          $9, $10, $11,
          $12, $13, $14,
          $15, $16::jsonb, $17,
          $18, $19
        )
      `,
      [
        candidateId,
        input.tournamentId,
        observation.matchId,
        input.batchId,
        observationId,
        candidate.previousAppliedCandidateId ?? null,
        candidate.sourceRevisionNumber,
        candidate.fingerprint,
        candidate.participantDigest,
        candidate.proposedStatus,
        candidate.proposedScoreAvailability,
        candidate.reason,
        candidate.requiresConfirmation,
        candidate.envelopeSchemaVersion,
        candidate.envelopeDigest,
        writeEngineJson(candidate.envelope),
        candidate.expectedMatchRowVersion,
        candidate.expectedSourceStateVersion,
        input.previewedAt
      ]
    );
    for (const team of [...candidate.teams]
      .sort((first, second) => first.sideNumber - second.sideNumber)) {
      await executor.query(
        `
          INSERT INTO engine_workbook_revision_candidate_teams (
            tournament_id, candidate_id, side_number, team_id,
            display_name_at_import
          ) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5)
        `,
        [
          input.tournamentId,
          candidateId,
          team.sideNumber,
          team.teamId,
          team.displayName
        ]
      );
      for (const player of team.players) {
        await executor.query(
          `
            INSERT INTO engine_workbook_revision_candidate_players (
              tournament_id, candidate_id, side_number, team_id, player_id,
              roster_membership_id, roster_slot, display_name_at_import
            ) VALUES (
              $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid,
              $6::uuid, $7, $8
            )
          `,
          [
            input.tournamentId,
            candidateId,
            team.sideNumber,
            team.teamId,
            player.playerId,
            player.rosterMembershipId,
            player.rosterSlot,
            player.displayName
          ]
        );
      }
    }
  }

  private async assertCandidateTeamsMatchSlots(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    matchId: string,
    candidate: WorkbookRevisionCandidateInput
  ): Promise<void> {
    const result = await executor.query<{
      slot_number: number;
      team_id: string | null;
    }>(`
      SELECT slot_number, team_id::text
      FROM engine_match_slots
      WHERE tournament_id = $1::uuid
        AND match_id = $2::uuid
        AND slot_number IN (1, 2)
      ORDER BY slot_number
      FOR KEY SHARE
    `, [tournamentId, matchId]);
    const candidateBySide = new Map<number, string>(
      candidate.teams.map((team) => [team.sideNumber, team.teamId])
    );
    if (result.rows.length !== 2 || result.rows.some((slot) =>
      slot.team_id === null || candidateBySide.get(slot.slot_number) !== slot.team_id
    )) {
      throw new EnginePersistenceInvariantError(
        "Workbook candidate participant teams do not match stable match slots."
      );
    }
  }

  private async findImportPreviewInTransaction(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    batchId: string
  ): Promise<WorkbookImportPreviewRecord | null> {
    const batchResult = await executor.query<ImportBatchRow>(
      `
        SELECT id::text, tournament_id::text, workbook_id::text,
               supersedes_batch_id::text, workbook_schema_version,
               source_workbook_digest, source_size_bytes,
               base_tournament_row_version, preview_digest, status,
               recognized_sheet_count, proposed_sheet_count,
               unchanged_sheet_count, missing_sheet_count, invalid_sheet_count,
               received_by_admin_id::text, received_at, previewed_at,
               preview_expires_at, confirmed_by_admin_id::text,
               confirmed_at, completed_at
        FROM engine_workbook_import_batches
        WHERE id = $1::uuid AND tournament_id = $2::uuid
      `,
      [batchId, tournamentId]
    );
    const batch = batchResult.rows[0];
    if (batch === undefined) {
      return null;
    }
    const observationRows = await this.readObservationRows(
      executor,
      tournamentId,
      batchId
    );
    const candidateIds = observationRows.flatMap((row) =>
      row.candidate_id === null ? [] : [row.candidate_id]
    );
    let teamRows: { rows: CandidateTeamRow[] } = { rows: [] };
    let playerRows: { rows: CandidatePlayerRow[] } = { rows: [] };
    if (candidateIds.length > 0) {
      teamRows = await executor.query<CandidateTeamRow>(`
          SELECT candidate_id::text, side_number, team_id::text,
                 display_name_at_import
          FROM engine_workbook_revision_candidate_teams
          WHERE candidate_id = ANY($1::uuid[])
          ORDER BY candidate_id, side_number
        `, [candidateIds]);
      playerRows = await executor.query<CandidatePlayerRow>(`
          SELECT candidate_id::text, side_number, team_id::text,
                 player_id::text, roster_membership_id::text,
                 roster_slot, display_name_at_import
          FROM engine_workbook_revision_candidate_players
          WHERE candidate_id = ANY($1::uuid[])
          ORDER BY candidate_id, side_number, roster_slot
        `, [candidateIds]);
    }
    return mapImportPreview(
      batch,
      observationRows,
      teamRows.rows,
      playerRows.rows
    );
  }

  private readObservationRows(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    batchId: string
  ): Promise<ImportObservationRow[]> {
    return executor.query<ImportObservationRow>(
      `
        SELECT observation.id::text, observation.batch_id::text,
               observation.observation_kind,
               observation.sheet_ordinal,
               observation.workbook_sheet_id::text,
               observation.match_id::text, observation.assignment_source,
               observation.disposition, observation.fingerprint,
               observation.base_match_row_version,
               observation.base_source_state_version,
               observation.source_envelope_schema_version,
               observation.source_envelope_digest,
               observation.source_envelope,
               observation.validation_issues,
               candidate.id::text AS candidate_id,
               candidate.previous_applied_candidate_id::text,
               candidate.source_revision_number,
               candidate.fingerprint AS candidate_fingerprint,
               candidate.participant_digest,
               candidate.proposed_status,
               candidate.proposed_score_availability,
               candidate.reason, candidate.requires_confirmation,
               candidate.envelope_schema_version,
               candidate.envelope_digest, candidate.envelope,
               candidate.base_match_row_version
                 AS candidate_base_match_row_version,
               candidate.base_source_state_version
                 AS candidate_base_source_state_version
        FROM engine_workbook_import_observations observation
        LEFT JOIN engine_workbook_revision_candidates candidate
          ON candidate.observation_id = observation.id
        WHERE observation.tournament_id = $1::uuid
          AND observation.batch_id = $2::uuid
        ORDER BY observation.sheet_ordinal NULLS LAST,
                 observation.match_id, observation.id
      `,
      [tournamentId, batchId]
    ).then((result) => result.rows);
  }

  private async confirmImportInTransaction(
    input: ConfirmWorkbookImportInput,
    transaction: TransactionContext
  ): Promise<WorkbookImportConfirmationResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const batch = await this.lockImportBatch(
      executor,
      input.tournamentId,
      input.batchId
    );
    if (batch.status !== "preview_ready") {
      throw new EnginePersistenceConflictError(
        "Workbook import preview is not available for confirmation."
      );
    }
    if (batch.preview_digest !== input.previewDigest) {
      throw new EnginePersistenceConflictError(
        "Workbook import preview digest no longer matches."
      );
    }
    const completedAt = await readServerTime(executor);
    if (Date.parse(completedAt) >= Date.parse(toIso(batch.preview_expires_at))) {
      throw new EnginePersistenceConflictError(
        "Workbook import preview has expired."
      );
    }
    const tournament = await executor.query<{ row_version: string | number }>(
      `
        SELECT row_version
        FROM engine_tournaments
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [input.tournamentId]
    );
    if (Number(tournament.rows[0]?.row_version) !==
        Number(batch.base_tournament_row_version)) {
      throw new EnginePersistenceConflictError(
        "Tournament changed after the workbook preview was prepared."
      );
    }
    const observations = await this.readObservationRows(
      executor,
      input.tournamentId,
      input.batchId
    );
    const storedPreview = await this.findImportPreviewInTransaction(
      executor,
      input.tournamentId,
      input.batchId
    );
    if (storedPreview === null) {
      throw new EnginePersistenceInvariantError(
        "Workbook import preview could not be reloaded for confirmation."
      );
    }
    const storedObservationById = new Map(
      storedPreview.observations.map((observation) => [
        observation.observationId,
        observation
      ])
    );
    const proposals = observations.filter((item) => item.disposition === "proposed");
    const accepted = new Set(input.acceptedObservationIds);
    const skipped = new Set(input.skippedObservationIds);
    const proposalIds = new Set(proposals.map((item) => item.id));
    assertCompletePartition(proposalIds, accepted, skipped);
    if (observations.some((item) =>
      item.disposition === "invalid" || item.disposition === "ambiguous"
    )) {
      throw new EnginePersistenceInvariantError(
        "Invalid or ambiguous workbook observations must be resolved first."
      );
    }

    const matchIds = [...new Set(observations.flatMap((item) =>
      item.match_id === null ? [] : [item.match_id]
    ))].sort();
    const matchStates = new Map<string, LockedMatchState>();
    for (const matchId of matchIds) {
      await lockEngineMatch(executor, matchId);
      matchStates.set(matchId, await this.lockMatchState(
        executor,
        input.tournamentId,
        matchId
      ));
    }
    for (const observation of observations) {
      if (observation.match_id === null) {
        continue;
      }
      const state = matchStates.get(observation.match_id);
      if (state === undefined ||
          Number(observation.base_match_row_version) !== state.matchRowVersion ||
          Number(observation.base_source_state_version) !== state.sourceStateVersion) {
        throw new EnginePersistenceConflictError(
          "Match or workbook source changed after preview."
        );
      }
      if (observation.candidate_id !== null &&
          observation.previous_applied_candidate_id !== state.activeCandidateId) {
        throw new EnginePersistenceConflictError(
          "Workbook candidate no longer extends the active source revision."
        );
      }
    }

    const selected = proposals.filter((item) => accepted.has(item.id));
    for (const [observationId, cascade] of Object.entries(
      input.playoffCorrectionCascades ?? {}
    )) {
      const observation = selected.find((item) => item.id === observationId);
      if (observation === undefined || observation.reason !== "correction" ||
          observation.proposed_status !== "final") {
        throw new EnginePersistenceInvariantError(
          "Playoff cascade confirmations may reference only selected final corrections."
        );
      }
      validateDigest(
        cascade.confirmationDigest,
        "Playoff cascade confirmation digest"
      );
      if (!isStableUuid(cascade.previousResolutionId) ||
          !isStableUuid(cascade.correctedResolutionId) ||
          !isStableUuid(cascade.correctedAdvancementId)) {
        throw new EnginePersistenceInvariantError(
          "Playoff cascade artifact identifiers must be stable UUIDs."
        );
      }
      parseStableUuid(cascade.correctedBracketMatchId, "bracket_match");
      parseStableUuid(cascade.correctedWinnerTeamId, "tournament_team");
    }
    const expectedConfirmationDigest = digestWorkbookValue({
      contract: "canonical-workbook-apply-v1",
      previewDigest: input.previewDigest,
      selected: [...selected]
        .sort((first, second) =>
          requiredMatchId(first).localeCompare(requiredMatchId(second))
        )
        .map((observation) => {
          if (observation.candidate_id === null) {
            throw new EnginePersistenceInvariantError(
              "Selected workbook proposal is missing its candidate identity."
            );
          }
          return {
            observationId: observation.id,
            candidateId: observation.candidate_id,
            correctionReason:
              input.correctionReasons?.[observation.id]?.trim() ?? null
          };
        })
    });
    if (expectedConfirmationDigest !== input.confirmationDigest) {
      throw new EnginePersistenceConflictError(
        "Workbook confirmation digest no longer matches the selected proposals."
      );
    }
    if (selected.length > 0) {
      await this.assertSelectedCandidateContinuity(
        executor,
        selected,
        matchStates
      );
    }
    const acquiredLeases: Array<{
      matchId: string;
      holderId: string;
      fencingToken: number;
    }> = [];
    for (const observation of selected.sort((first, second) =>
      requiredMatchId(first).localeCompare(requiredMatchId(second))
    )) {
      const matchId = requiredMatchId(observation);
      const state = matchStates.get(matchId);
      if (state === undefined || observation.candidate_id === null ||
          observation.candidate_fingerprint === null ||
          observation.participant_digest === null ||
          observation.source_revision_number === null) {
        throw new EnginePersistenceInvariantError(
          "Selected workbook proposal is incomplete."
        );
      }
      const reason = input.correctionReasons?.[observation.id]?.trim();
      const confirmationRequired = observation.requires_confirmation === true ||
        observation.reason === "correction";
      if (confirmationRequired && (reason === undefined || reason.length < 3)) {
        throw new EnginePersistenceInvariantError(
          "Confirmed corrections require a reason of at least 3 characters."
        );
      }
      if (reason !== undefined && (reason.length < 3 || reason.length > 500)) {
        throw new EnginePersistenceInvariantError(
          "Correction reason must contain between 3 and 500 characters."
        );
      }
      if (Number(observation.source_revision_number) !==
          state.sourceStateVersion + 1) {
        throw new EnginePersistenceConflictError(
          "Workbook candidate source revision is stale."
        );
      }
      if (state.participantDigest !== null &&
          state.participantDigest !== observation.participant_digest) {
        throw new EnginePersistenceConflictError(
          "Workbook participants are frozen after the first applied source."
        );
      }
      if (state.activeFingerprint === observation.candidate_fingerprint) {
        throw new EnginePersistenceConflictError(
          "An unchanged workbook sheet cannot create a new source revision."
        );
      }
      const holderId = `workbook-import:${input.batchId}`;
      const lease = await this.writers.acquireInTransaction({
        tournamentId: input.tournamentId,
        matchId: matchId as never,
        mode: "excel_import",
        holderId,
        acquiredAt: completedAt,
        expiresAt: new Date(
          Date.parse(completedAt) + WRITER_LEASE_MILLISECONDS
        ).toISOString()
      }, transaction);
      if (!lease.acquired) {
        throw new EngineWriterLeaseConflictError(
          "A selected match has another active scoring writer."
        );
      }
      acquiredLeases.push({
        matchId,
        holderId,
        fencingToken: lease.fencingToken
      });
    }

    const activatedCandidates: Array<{
      observationId: string;
      matchId: string;
      candidateId: string;
      revisionId: string;
      matchRowVersion: number;
      writerFencingToken: number;
      confirmationDigest: string;
      materializedByAdminId: string;
      replayedPhaseThreeSource: boolean;
    }> = [];
    for (const observation of [...selected].sort((first, second) =>
      requiredMatchId(first).localeCompare(requiredMatchId(second))
    )) {
      const matchId = requiredMatchId(observation);
      const lease = acquiredLeases.find((item) => item.matchId === matchId);
      const state = matchStates.get(matchId);
      const candidate = storedObservationById.get(observation.id)?.candidate;
      if (lease === undefined || state === undefined || candidate === null ||
          candidate === undefined) {
        throw new EnginePersistenceInvariantError(
          "Selected workbook candidate could not be materialized."
        );
      }
      const predecessors = state.activeRevisionId === null &&
        observation.previous_applied_candidate_id !== null
        ? await this.readUnmaterializedPredecessorChain(
          executor,
          input.tournamentId,
          observation.previous_applied_candidate_id
        )
        : [];
      const materializationContexts: CandidateMaterializationContext[] = [
        ...predecessors,
        {
          candidate,
          batchId: input.batchId,
          observationId: observation.id,
          actorId: input.confirmedByAdminId,
          createdAt: completedAt,
          confirmationDigest: input.confirmationDigest,
          ...(input.correctionReasons?.[observation.id] === undefined
            ? {}
            : {
                correctionReason:
                  input.correctionReasons[observation.id]?.trim()
              }),
          replayedPhaseThreeSource: false
        }
      ];
      let activeRevision = state.activeRevisionId === null
        ? undefined
        : {
            id: state.activeRevisionId as never,
            revisionNumber: state.activeRevisionNumber
          };
      let expectedMatchRowVersion = state.matchRowVersion;
      for (const context of materializationContexts) {
        const replayCandidate = {
          ...context.candidate,
          expectedMatchRowVersion
        };
        const materialized = materializeWorkbookCandidate({
          candidate: replayCandidate,
          tournamentId: input.tournamentId,
          batchId: context.batchId,
          observationId: context.observationId,
          actorId: context.actorId,
          createdAt: context.createdAt,
          confirmationDigest: context.confirmationDigest,
          ...(context.correctionReason === undefined
            ? {}
            : { correctionReason: context.correctionReason }),
          ...(activeRevision === undefined ? {} : { activeRevision })
        });
        const activated = await this.revisions.activateRevisionInTransaction({
          ...materialized.activation,
          writerFence: {
            mode: "excel_import",
            holderId: lease.holderId,
            fencingToken: lease.fencingToken,
            checkedAt: completedAt
          },
          audit: {
            eventId: scopedId(
              context.batchId,
              context.replayedPhaseThreeSource
                ? "phase4-replay-revision-audit"
                : "revision-audit",
              context.observationId
            ),
            commandType: context.replayedPhaseThreeSource
              ? "phase3_workbook_source_materialized"
              : "workbook_match_revision_activated",
            actor: { kind: "administrator", id: context.actorId },
            occurredAt: completedAt,
            correlationId: input.audit.correlationId,
            causationId: input.audit.causationId,
            details: {
              batchId: context.batchId,
              observationId: context.observationId,
              candidateId: context.candidate.candidateId,
              confirmationDigest: context.confirmationDigest,
              sourceRevisionNumber: context.candidate.sourceRevisionNumber,
              eventCount: materialized.activation.events.length,
              replayedPhaseThreeSource: context.replayedPhaseThreeSource
            }
          }
        }, transaction);
        activatedCandidates.push({
          observationId: context.observationId,
          matchId,
          candidateId: context.candidate.candidateId,
          revisionId: activated.revisionId,
          matchRowVersion: activated.matchRowVersion,
          writerFencingToken: lease.fencingToken,
          confirmationDigest: context.confirmationDigest,
          materializedByAdminId: context.actorId,
          replayedPhaseThreeSource: context.replayedPhaseThreeSource
        });
        activeRevision = {
          id: activated.revisionId as never,
          revisionNumber: materialized.activation.revision.revisionNumber
        };
        expectedMatchRowVersion = activated.matchRowVersion;
      }
    }

    const statisticResult = activatedCandidates.length === 0
      ? null
      : await this.statistics.persistMaterializedBatchInTransaction({
        tournamentId: input.tournamentId,
        rulesVersion: RUSKI_CANONICAL_SCORING_RULES_VERSION,
        calculatedAt: completedAt,
        materializations: activatedCandidates.map((materialized) => ({
          matchId: materialized.matchId,
          revisionId: materialized.revisionId,
          candidateId: materialized.candidateId,
          confirmationDigest: materialized.confirmationDigest,
          adapterVersion: 1,
          materializedByAdminId: materialized.materializedByAdminId,
          writerFencingToken: materialized.writerFencingToken,
          materializedAt: completedAt
        }))
      }, transaction);

    const replacementMatchIds: string[] = [];
    if (activatedCandidates.some((item) => !item.replayedPhaseThreeSource)) {
      await this.startPodPlayIfNeeded(executor, input, completedAt);
      for (const materialized of activatedCandidates.filter(
        (item) => !item.replayedPhaseThreeSource
      )) {
        const cascade = input.playoffCorrectionCascades?.[
          materialized.observationId
        ];
        if (cascade !== undefined) {
          const currentVersion = await executor.query<{
            row_version: string | number;
          }>(`
            SELECT row_version FROM engine_tournaments
            WHERE id = $1::uuid FOR UPDATE
          `, [input.tournamentId]);
          const result = await this.progression
            .replaceStartedDependentsForActiveCorrectionInTransaction({
              tournamentId: input.tournamentId,
              expectedTournamentRowVersion: Number(
                currentVersion.rows[0]?.row_version
              ),
              previousResolutionId: cascade.previousResolutionId,
              confirmationDigest: cascade.confirmationDigest,
              administratorId: input.confirmedByAdminId,
              occurredAt: completedAt,
              correctedSource: {
                resolutionId: cascade.correctedResolutionId,
                advancementId: cascade.correctedAdvancementId,
                bracketMatchId: parseStableUuid(
                  cascade.correctedBracketMatchId,
                  "bracket_match"
                ),
                matchId: parseStableUuid(materialized.matchId, "match"),
                revisionId: parseStableUuid(
                  materialized.revisionId,
                  "match_revision"
                ),
                winnerTeamId: parseStableUuid(
                  cascade.correctedWinnerTeamId,
                  "tournament_team"
                ),
                matchStatus: "final"
              },
              replacements: cascade.replacements
            }, transaction);
          replacementMatchIds.push(...result.replacementMatchIds);
          continue;
        }
        await this.progression.refreshProgressionAfterRevisionInTransaction({
          tournamentId: input.tournamentId,
          matchId: materialized.matchId as never,
          revisionId: materialized.revisionId as never,
          confirmationDigest: input.confirmationDigest,
          actorId: input.confirmedByAdminId,
          occurredAt: completedAt
        }, transaction);
      }
    }

    const appliedMatchIds: string[] = [];
    const skippedMatchIds: string[] = [];
    const unchangedMatchIds: string[] = [];
    const missingMatchIds: string[] = [];
    for (const observation of observations) {
      if (observation.disposition === "proposed") {
        if (accepted.has(observation.id)) {
          const matchId = requiredMatchId(observation);
          const lease = acquiredLeases.find((item) => item.matchId === matchId);
          if (lease === undefined) {
            throw new EnginePersistenceInvariantError(
              "Selected match writer lease was not acquired."
            );
          }
          await assertEngineWriterFence(executor, {
            matchId,
            mode: "excel_import",
            holderId: lease.holderId,
            fencingToken: lease.fencingToken,
            checkedAt: completedAt
          });
          await this.advanceMatchSourceState(
            executor,
            input.tournamentId,
            observation,
            completedAt
          );
          await this.insertImportDecision(
            executor,
            input,
            observation,
            "accepted",
            "administrator",
            input.correctionReasons?.[observation.id]?.trim() ?? null,
            completedAt
          );
          appliedMatchIds.push(matchId);
        } else {
          await this.insertImportDecision(
            executor,
            input,
            observation,
            "skipped",
            "administrator",
            null,
            completedAt
          );
          skippedMatchIds.push(requiredMatchId(observation));
        }
      } else if (observation.disposition === "unchanged") {
        await this.insertImportDecision(
          executor,
          input,
          observation,
          "no_op",
          "system",
          null,
          completedAt
        );
        unchangedMatchIds.push(requiredMatchId(observation));
      } else if (observation.disposition === "missing") {
        await this.insertImportDecision(
          executor,
          input,
          observation,
          "missing_non_destructive",
          "system",
          null,
          completedAt
        );
        missingMatchIds.push(requiredMatchId(observation));
      }
    }

    for (const lease of acquiredLeases) {
      const released = await this.writers.releaseInTransaction({
        tournamentId: input.tournamentId,
        matchId: lease.matchId as never,
        holderId: lease.holderId,
        fencingToken: lease.fencingToken,
        releasedAt: completedAt
      }, transaction);
      if (!released) {
        throw new EnginePersistenceInvariantError(
          "Workbook writer lease could not be released."
        );
      }
    }
    const status = appliedMatchIds.length === 0 ? "no_op" : "applied";
    const updated = await executor.query(
      `
        UPDATE engine_workbook_import_batches
        SET status = $3, confirmed_by_admin_id = $4::uuid,
            confirmed_at = $5, completed_at = $5
        WHERE id = $1::uuid AND tournament_id = $2::uuid
          AND status = 'preview_ready'
      `,
      [
        input.batchId,
        input.tournamentId,
        status,
        input.confirmedByAdminId,
        completedAt
      ]
    );
    if (updated.rowCount !== 1) {
      throw new EnginePersistenceConflictError(
        "Workbook import preview changed during confirmation."
      );
    }
    await writeEngineAuditEvent(executor, input.tournamentId, {
      eventId: input.audit.eventId,
      commandType: status === "applied"
        ? "workbook_import_applied"
        : "workbook_import_no_op",
      actor: { kind: "administrator", id: input.confirmedByAdminId },
      occurredAt: completedAt,
      correlationId: input.audit.correlationId,
      causationId: input.audit.causationId,
      details: {
        batchId: input.batchId,
        previewDigest: input.previewDigest,
        confirmationDigest: input.confirmationDigest,
        appliedCount: appliedMatchIds.length,
        replayedPhaseThreeSourceCount: activatedCandidates.filter(
          (item) => item.replayedPhaseThreeSource
        ).length,
        skippedCount: skippedMatchIds.length,
        unchangedCount: unchangedMatchIds.length,
        missingCount: missingMatchIds.length,
        tournamentStatisticRunId:
          statisticResult?.tournamentStatisticRunId ?? null,
        tournamentStatisticRunDigest:
          statisticResult?.tournamentStatisticRunDigest ?? null
      }
    });
    const matchStatisticRunByRevisionId = new Map(
      statisticResult?.materialized.map((item) => [
        item.revisionId,
        item.matchStatisticRunId
      ]) ?? []
    );
    return {
      batchId: input.batchId,
      tournamentId: input.tournamentId,
      status,
      appliedMatchIds,
      skippedMatchIds,
      unchangedMatchIds,
      missingMatchIds,
      materializedRevisions: activatedCandidates
        .filter((materialized) => !materialized.replayedPhaseThreeSource)
        .map((materialized) => {
        const matchStatisticRunId = matchStatisticRunByRevisionId.get(
          materialized.revisionId
        );
        if (matchStatisticRunId === undefined) {
          throw new EnginePersistenceInvariantError(
            "Materialized workbook revision is missing its statistic run."
          );
        }
        return {
          matchId: materialized.matchId,
          candidateId: materialized.candidateId,
          revisionId: materialized.revisionId,
          matchStatisticRunId,
          matchRowVersion: materialized.matchRowVersion
        };
      }),
      replacementMatchIds,
      tournamentStatisticRunId:
        statisticResult?.tournamentStatisticRunId ?? null,
      tournamentStatisticRunDigest:
        statisticResult?.tournamentStatisticRunDigest ?? null,
      completedAt
    };
  }

  private async assertSelectedCandidateContinuity(
    executor: EnginePostgresExecutor,
    selected: readonly ImportObservationRow[],
    matchStates: ReadonlyMap<string, LockedMatchState>
  ): Promise<void> {
    for (const observation of selected) {
      const state = matchStates.get(requiredMatchId(observation));
      if (observation.previous_applied_candidate_id === null ||
          state?.activeRevisionId === null || state === undefined) {
        continue;
      }
      const result = await executor.query(
        `
          SELECT 1
          FROM engine_workbook_candidate_materializations
          WHERE candidate_id = $1::uuid
            AND match_id = $2::uuid
            AND revision_id = $3::uuid
        `,
        [
          observation.previous_applied_candidate_id,
          requiredMatchId(observation),
          state.activeRevisionId
        ]
      );
      if (result.rows[0] === undefined) {
        throw new EnginePersistenceConflictError(
          "Workbook source and canonical scoring history have diverged."
        );
      }
    }
  }

  private async readUnmaterializedPredecessorChain(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    latestCandidateId: string
  ): Promise<CandidateMaterializationContext[]> {
    const reversed: CandidateMaterializationContext[] = [];
    const visited = new Set<string>();
    let candidateId: string | null = latestCandidateId;
    while (candidateId !== null) {
      if (visited.has(candidateId)) {
        throw new EnginePersistenceInvariantError(
          "Workbook source candidate history contains a cycle."
        );
      }
      visited.add(candidateId);
      const rows: AcceptedCandidateReplayRow[] = (await executor.query<
        AcceptedCandidateReplayRow
      >(
        `
          SELECT candidate.id::text AS candidate_id,
                 candidate.batch_id::text,
                 candidate.observation_id::text,
                 candidate.previous_applied_candidate_id::text,
                 decision.administrator_id::text,
                 decision.reason,
                 decision.decided_at,
                 materialization.revision_id::text
                   AS materialized_revision_id
          FROM engine_workbook_revision_candidates candidate
          JOIN engine_workbook_import_decisions decision
            ON decision.tournament_id = candidate.tournament_id
           AND decision.batch_id = candidate.batch_id
           AND decision.observation_id = candidate.observation_id
           AND decision.candidate_id = candidate.id
           AND decision.decision = 'accepted'
           AND decision.actor_kind = 'administrator'
          LEFT JOIN engine_workbook_candidate_materializations materialization
            ON materialization.candidate_id = candidate.id
          WHERE candidate.tournament_id = $1::uuid
            AND candidate.id = $2::uuid
          FOR KEY SHARE OF candidate, decision
        `,
        [tournamentId, candidateId]
      )).rows;
      const row: AcceptedCandidateReplayRow | undefined = rows[0];
      if (row === undefined) {
        throw new EnginePersistenceConflictError(
          "An accepted Phase 3 workbook source is unavailable for replay."
        );
      }
      if (row.materialized_revision_id !== null) {
        throw new EnginePersistenceConflictError(
          "Workbook source and canonical active revision are inconsistent."
        );
      }
      const preview = await this.findImportPreviewInTransaction(
        executor,
        tournamentId,
        row.batch_id
      );
      const storedObservation = preview?.observations.find(
        (observation) => observation.observationId === row.observation_id
      );
      const candidate = storedObservation?.candidate;
      if (candidate === null || candidate === undefined ||
          candidate.candidateId !== row.candidate_id) {
        throw new EnginePersistenceInvariantError(
          "An accepted Phase 3 workbook candidate could not be reconstructed."
        );
      }
      const correctionReason = candidate.reason === "correction"
        ? row.reason?.trim()
        : undefined;
      if (candidate.reason === "correction" &&
          (correctionReason === undefined || correctionReason.length < 3)) {
        throw new EnginePersistenceInvariantError(
          "A replayed Phase 3 correction requires its accepted reason."
        );
      }
      reversed.push({
        candidate,
        batchId: row.batch_id,
        observationId: row.observation_id,
        actorId: row.administrator_id,
        createdAt: toIso(row.decided_at),
        confirmationDigest: digestWorkbookValue({
          contract: "phase3-workbook-source-replay-v1",
          batchId: row.batch_id,
          observationId: row.observation_id,
          candidateId: row.candidate_id
        }),
        ...(correctionReason === undefined ? {} : { correctionReason }),
        replayedPhaseThreeSource: true
      });
      candidateId = row.previous_applied_candidate_id;
    }
    return reversed.reverse();
  }

  private async startPodPlayIfNeeded(
    executor: EnginePostgresExecutor,
    input: ConfirmWorkbookImportInput,
    startedAt: string
  ): Promise<void> {
    const updated = await executor.query(
      `
        UPDATE engine_tournaments
        SET lifecycle = 'pod_play',
            row_version = row_version + 1,
            updated_at = $2
        WHERE id = $1::uuid AND lifecycle = 'setup_published'
      `,
      [input.tournamentId, startedAt]
    );
    if (updated.rowCount !== 1) {
      return;
    }
    await writeEngineAuditEvent(executor, input.tournamentId, {
      eventId: scopedId(
        input.batchId,
        "tournament-pod-play-started",
        input.tournamentId
      ),
      commandType: "tournament_pod_play_started",
      actor: { kind: "administrator", id: input.confirmedByAdminId },
      occurredAt: startedAt,
      correlationId: input.audit.correlationId,
      causationId: input.audit.causationId,
      details: { batchId: input.batchId }
    });
  }

  private async assertPublishedTournamentVersion(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    expectedRowVersion: number
  ): Promise<void> {
    const result = await executor.query<{
      lifecycle: string;
      row_version: string | number;
    }>(
      `
        SELECT lifecycle, row_version
        FROM engine_tournaments
        WHERE id = $1::uuid
        FOR KEY SHARE
      `,
      [tournamentId]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new EnginePersistenceInvariantError("Tournament was not found.");
    }
    if (row.lifecycle === "draft_setup") {
      throw new EnginePersistenceConflictError(
        "Workbook operations require published tournament setup."
      );
    }
    if (Number(row.row_version) !== expectedRowVersion) {
      throw new EnginePersistenceConflictError(
        "Tournament changed after workbook source was read."
      );
    }
  }

  private async assertObservationBase(
    executor: EnginePostgresExecutor,
    input: CreateWorkbookImportPreviewInput,
    observation: WorkbookImportObservationInput
  ): Promise<void> {
    if (observation.observationKind === "present") {
      if (digestWorkbookValue(observation.sourceEnvelope) !==
          observation.sourceEnvelopeDigest) {
        throw new EnginePersistenceInvariantError(
          "Normalized workbook source envelope digest does not match."
        );
      }
      if (observation.disposition === "proposed" &&
          observation.candidate === undefined) {
        throw new EnginePersistenceInvariantError(
          "A proposed workbook observation requires a candidate."
        );
      }
      if (observation.disposition !== "proposed" &&
          observation.candidate !== undefined) {
        throw new EnginePersistenceInvariantError(
          "Only proposed workbook observations may contain a candidate."
        );
      }
    }
    if (observation.matchId === undefined) {
      return;
    }
    const state = await this.lockMatchState(
      executor,
      input.tournamentId,
      observation.matchId
    );
    if (state.matchRowVersion !== observation.baseMatchRowVersion ||
        state.sourceStateVersion !== observation.baseSourceStateVersion) {
      throw new EnginePersistenceConflictError(
        "Workbook observation was prepared from stale match state."
      );
    }
    const candidate = observation.observationKind === "present"
      ? observation.candidate
      : undefined;
    if (candidate !== undefined &&
        candidate.previousAppliedCandidateId !==
          (state.activeCandidateId ?? undefined)) {
      throw new EnginePersistenceConflictError(
        "Workbook candidate does not extend active source state."
      );
    }
  }

  private async lockMatchState(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    matchId: string
  ): Promise<LockedMatchState> {
    const match = await executor.query<{
      row_version: string | number;
      active_revision_id: string | null;
      active_revision_number: number | null;
      active_candidate_id: string | null;
      active_fingerprint: string | null;
      participant_digest: string | null;
      source_state_version: string | number | null;
    }>(
      `
        SELECT match.row_version,
               match.active_revision_id::text,
               revision.revision_number AS active_revision_number,
               state.active_candidate_id::text,
               state.active_fingerprint,
               state.participant_digest,
               state.row_version AS source_state_version
        FROM engine_matches match
        LEFT JOIN engine_match_workbook_source_states state
          ON state.tournament_id = match.tournament_id
         AND state.match_id = match.id
        LEFT JOIN engine_match_revisions revision
          ON revision.id = match.active_revision_id
        WHERE match.id = $1::uuid
          AND match.tournament_id = $2::uuid
          AND NOT match.identity_only
        FOR UPDATE OF match
      `,
      [matchId, tournamentId]
    );
    const row = match.rows[0];
    if (row === undefined) {
      throw new EnginePersistenceInvariantError(
        "Writable tournament match was not found."
      );
    }
    if (row.source_state_version !== null) {
      await executor.query(
        `
          SELECT 1
          FROM engine_match_workbook_source_states
          WHERE tournament_id = $1::uuid AND match_id = $2::uuid
          FOR UPDATE
        `,
        [tournamentId, matchId]
      );
    }
    return {
      matchRowVersion: Number(row.row_version),
      activeRevisionId: row.active_revision_id,
      activeRevisionNumber: Number(row.active_revision_number ?? 0),
      sourceStateVersion: Number(row.source_state_version ?? 0),
      activeCandidateId: row.active_candidate_id,
      activeFingerprint: row.active_fingerprint,
      participantDigest: row.participant_digest
    };
  }

  private async advanceMatchSourceState(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    observation: ImportObservationRow,
    completedAt: string
  ): Promise<void> {
    if (observation.match_id === null || observation.candidate_id === null ||
        observation.candidate_fingerprint === null ||
        observation.participant_digest === null) {
      throw new EnginePersistenceInvariantError(
        "Applied workbook candidate is incomplete."
      );
    }
    const expectedVersion = Number(observation.base_source_state_version);
    if (expectedVersion === 0) {
      await executor.query(
        `
          INSERT INTO engine_match_workbook_source_states (
            tournament_id, match_id, active_candidate_id,
            active_fingerprint, participant_digest, source_batch_id,
            source_observation_id, row_version, updated_at
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid,
            $4, $5, $6::uuid,
            $7::uuid, 1, $8
          )
        `,
        [
          tournamentId,
          observation.match_id,
          observation.candidate_id,
          observation.candidate_fingerprint,
          observation.participant_digest,
          observationBatchIdRequired(observation),
          observation.id,
          completedAt
        ]
      );
      return;
    }
    const updated = await executor.query(
      `
        UPDATE engine_match_workbook_source_states
        SET active_candidate_id = $3::uuid,
            active_fingerprint = $4,
            participant_digest = $5,
            source_batch_id = $6::uuid,
            source_observation_id = $7::uuid,
            row_version = row_version + 1,
            updated_at = $8
        WHERE tournament_id = $1::uuid
          AND match_id = $2::uuid
          AND row_version = $9
      `,
      [
        tournamentId,
        observation.match_id,
        observation.candidate_id,
        observation.candidate_fingerprint,
        observation.participant_digest,
        observationBatchIdRequired(observation),
        observation.id,
        completedAt,
        expectedVersion
      ]
    );
    if (updated.rowCount !== 1) {
      throw new EnginePersistenceConflictError(
        "Workbook source state changed during confirmation."
      );
    }
  }

  private async insertImportDecision(
    executor: EnginePostgresExecutor,
    input: ConfirmWorkbookImportInput,
    observation: ImportObservationRow,
    decision: "accepted" | "skipped" | "no_op" | "missing_non_destructive",
    actorKind: "administrator" | "system",
    reason: string | null,
    decidedAt: string
  ): Promise<void> {
    await executor.query(
      `
        INSERT INTO engine_workbook_import_decisions (
          id, tournament_id, batch_id, observation_id, match_id,
          candidate_id, decision, actor_kind, administrator_id,
          reason, preview_digest, decided_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
          $6::uuid, $7, $8, $9::uuid,
          $10, $11, $12
        )
      `,
      [
        scopedId(input.batchId, "decision", observation.id),
        input.tournamentId,
        input.batchId,
        observation.id,
        observation.match_id,
        observation.candidate_id,
        decision,
        actorKind,
        actorKind === "administrator" ? input.confirmedByAdminId : null,
        reason,
        input.previewDigest,
        decidedAt
      ]
    );
  }

  private lockImportBatch(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    batchId: string
  ): Promise<ImportBatchRow> {
    return executor.query<ImportBatchRow>(
      `
        SELECT id::text, tournament_id::text, workbook_id::text,
               supersedes_batch_id::text, workbook_schema_version,
               source_workbook_digest, source_size_bytes,
               base_tournament_row_version, preview_digest, status,
               recognized_sheet_count, proposed_sheet_count,
               unchanged_sheet_count, missing_sheet_count, invalid_sheet_count,
               received_by_admin_id::text, received_at, previewed_at,
               preview_expires_at, confirmed_by_admin_id::text,
               confirmed_at, completed_at
        FROM engine_workbook_import_batches
        WHERE id = $1::uuid AND tournament_id = $2::uuid
        FOR UPDATE
      `,
      [batchId, tournamentId]
    ).then((result) => {
      const row = result.rows[0];
      if (row === undefined) {
        throw new EnginePersistenceInvariantError(
          "Workbook import preview was not found."
        );
      }
      return row;
    });
  }

  private writePreviewAudit(
    executor: EnginePostgresExecutor,
    tournamentId: TournamentId,
    administratorId: string,
    batchId: string,
    previewDigest: string,
    observations: readonly WorkbookImportObservationInput[],
    commandType: string,
    occurredAt: string,
    audit: { eventId: string; correlationId?: string; causationId?: string }
  ): Promise<void> {
    const counts = observationCounts(observations);
    return writeEngineAuditEvent(executor, tournamentId, {
      eventId: audit.eventId,
      commandType,
      actor: { kind: "administrator", id: administratorId },
      occurredAt,
      correlationId: audit.correlationId,
      causationId: audit.causationId,
      details: { batchId, previewDigest, ...counts }
    });
  }
}

interface LockedMatchState {
  matchRowVersion: number;
  activeRevisionId: string | null;
  activeRevisionNumber: number;
  sourceStateVersion: number;
  activeCandidateId: string | null;
  activeFingerprint: string | null;
  participantDigest: string | null;
}

function mapGenerationPlayer(
  row: GenerationPlayerRow
): WorkbookGenerationSourcePlayerRecord {
  return {
    playerId: row.player_id,
    rosterMembershipId: row.membership_id,
    rosterSlot: row.roster_slot,
    displayName: row.display_name
  };
}

function mapGenerationMatch(
  row: GenerationMatchRow,
  teamById: ReadonlyMap<string, WorkbookGenerationSourceTeamRecord>,
  candidateTeams: readonly CandidateTeamRow[],
  candidatePlayers: readonly CandidatePlayerRow[],
  revisionTeams: readonly RevisionTeamRow[],
  revisionPlayers: readonly RevisionPlayerRow[]
): WorkbookGenerationSourceMatchRecord {
  if (row.side_one_team_id === null || row.side_two_team_id === null) {
    throw new EnginePersistenceInvariantError(
      "Generated workbook match participants must be resolved."
    );
  }
  const hasState = row.source_state_version !== null;
  if (hasState && (
    row.active_candidate_id === null || row.active_fingerprint === null ||
    row.participant_digest === null || row.source_revision_number === null ||
    row.proposed_status === null
  )) {
    throw new EnginePersistenceInvariantError(
      "Workbook source state is missing active candidate metadata."
    );
  }
  const participantTeams = row.active_revision_id !== null
    ? mapRevisionGenerationTeams(
      row.active_revision_id,
      revisionTeams,
      revisionPlayers
    )
    : hasState
      ? mapCandidateGenerationTeams(
      requiredString(row.active_candidate_id),
      candidateTeams,
      candidatePlayers
      )
      : mapCurrentGenerationTeams(
      [row.side_one_team_id, row.side_two_team_id],
      teamById
      );
  const common = {
    matchId: row.id,
    sequence: row.sequence,
    rowVersion: Number(row.row_version),
    status: row.status,
    scoreAvailability: row.score_availability,
    participantTeamIds: [row.side_one_team_id, row.side_two_team_id] as const,
    participantTeams,
    activeScoringPreview: row.active_revision_id === null
      ? null
      : mapActiveScoringPreview(row.active_revision_id, revisionTeams),
    activeScorecardSource: mapActiveScorecardSource(row, participantTeams),
    workbookState: !hasState ? null : {
      rowVersion: Number(row.source_state_version),
      sourceRevisionNumber: Number(row.source_revision_number),
      activeCandidateId: requiredString(row.active_candidate_id),
      activeFingerprint: requiredString(row.active_fingerprint),
      participantDigest: requiredString(row.participant_digest),
      proposedStatus: row.proposed_status as WorkbookGenerationSourceMatchRecord[
        "status"
      ]
    }
  };
  if (row.stage === "pod_play") {
    if (row.pod_id === null) {
      throw new EnginePersistenceInvariantError(
        "Pod-play workbook match is missing its pod identity."
      );
    }
    return {
      ...common,
      stage: "pod_play",
      podId: row.pod_id,
      bracketMatchId: null,
      sequenceInPod: positiveMetadataInteger(row.metadata, "sequenceInPod"),
      roundNumber: positiveMetadataInteger(row.metadata, "roundNumber"),
      gameNumberForPair: positiveMetadataInteger(
        row.metadata,
        "gameNumberForPair"
      ),
      sequenceInRound: null
    };
  }
  if (row.pod_id !== null || row.bracket_match_id === null ||
      row.bracket_round_number === null || row.sequence_in_round === null) {
    throw new EnginePersistenceInvariantError(
      "Playoff workbook match is missing its bracket identity."
    );
  }
  return {
    ...common,
    stage: "playoffs",
    podId: null,
    bracketMatchId: row.bracket_match_id,
    sequenceInPod: null,
    roundNumber: row.bracket_round_number,
    gameNumberForPair: null,
    sequenceInRound: Number(row.sequence_in_round)
  };
}

function mapCurrentGenerationTeams(
  teamIds: readonly [string, string],
  teamById: ReadonlyMap<string, WorkbookGenerationSourceTeamRecord>
): readonly [
  WorkbookGenerationSourceMatchTeamRecord,
  WorkbookGenerationSourceMatchTeamRecord
] {
  const mapped = teamIds.map((teamId, index) => {
    const team = teamById.get(teamId);
    if (team === undefined) {
      throw new EnginePersistenceInvariantError(
        "Workbook match participant team was not found."
      );
    }
    return {
      sideNumber: (index + 1) as 1 | 2,
      teamId,
      name: team.name,
      players: team.players
    };
  });
  const sideOne = mapped[0];
  const sideTwo = mapped[1];
  if (sideOne === undefined || sideTwo === undefined) {
    throw new EnginePersistenceInvariantError(
      "Workbook match requires two participant teams."
    );
  }
  return [sideOne, sideTwo];
}

function mapCandidateGenerationTeams(
  candidateId: string,
  teams: readonly CandidateTeamRow[],
  players: readonly CandidatePlayerRow[]
): readonly [
  WorkbookGenerationSourceMatchTeamRecord,
  WorkbookGenerationSourceMatchTeamRecord
] {
  const mapped = teams.filter((team) => team.candidate_id === candidateId)
    .map((team) => ({
      sideNumber: team.side_number,
      teamId: team.team_id,
      name: team.display_name_at_import,
      players: players.filter((player) =>
        player.candidate_id === candidateId &&
        player.side_number === team.side_number
      ).map((player) => ({
        playerId: player.player_id,
        rosterMembershipId: player.roster_membership_id,
        rosterSlot: player.roster_slot,
        displayName: player.display_name_at_import
      }))
    }));
  const sideOne = mapped[0];
  const sideTwo = mapped[1];
  if (mapped.length !== 2 || sideOne?.sideNumber !== 1 ||
      sideTwo?.sideNumber !== 2) {
    throw new EnginePersistenceInvariantError(
      "Active workbook candidate participant ledger is incomplete."
    );
  }
  return [sideOne, sideTwo];
}

function mapRevisionGenerationTeams(
  revisionId: string,
  teams: readonly RevisionTeamRow[],
  players: readonly RevisionPlayerRow[]
): readonly [
  WorkbookGenerationSourceMatchTeamRecord,
  WorkbookGenerationSourceMatchTeamRecord
] {
  const mapped = teams.filter((team) => team.revision_id === revisionId)
    .map((team) => ({
      sideNumber: team.side_number,
      teamId: team.team_id,
      name: team.display_name_at_revision,
      players: players.filter((player) =>
        player.revision_id === revisionId &&
        player.side_number === team.side_number
      ).map((player) => ({
        playerId: player.player_id,
        rosterMembershipId: player.roster_membership_id,
        rosterSlot: player.roster_slot,
        displayName: player.display_name_at_revision
      }))
    }));
  const sideOne = mapped[0];
  const sideTwo = mapped[1];
  if (mapped.length !== 2 || sideOne?.sideNumber !== 1 ||
      sideTwo?.sideNumber !== 2) {
    throw new EnginePersistenceInvariantError(
      "Active canonical revision participant ledger is incomplete."
    );
  }
  return [sideOne, sideTwo];
}

function mapActiveScoringPreview(
  revisionId: string,
  teams: readonly RevisionTeamRow[]
): NonNullable<WorkbookGenerationSourceMatchRecord["activeScoringPreview"]> {
  const revisionTeams = teams.filter((team) => team.revision_id === revisionId);
  const sideOne = revisionTeams.find((team) => team.side_number === 1);
  const sideTwo = revisionTeams.find((team) => team.side_number === 2);
  if (revisionTeams.length !== 2 || sideOne === undefined || sideTwo === undefined) {
    throw new EnginePersistenceInvariantError(
      "Active canonical revision score ledger is incomplete."
    );
  }
  return {
    revisionId,
    teams: [
      {
        sideNumber: 1,
        teamId: sideOne.team_id,
        score: sideOne.score,
        result: sideOne.result
      },
      {
        sideNumber: 2,
        teamId: sideTwo.team_id,
        score: sideTwo.score,
        result: sideTwo.result
      }
    ],
    winnerTeamId: revisionTeams.find((team) => team.result === "win")?.team_id ?? null
  };
}

function mapActiveScorecardSource(
  row: GenerationMatchRow,
  teams: readonly [
    WorkbookGenerationSourceMatchTeamRecord,
    WorkbookGenerationSourceMatchTeamRecord
  ]
): WorkbookGenerationSourceMatchRecord["activeScorecardSource"] {
  if ((row.status !== "in_progress" && row.status !== "final") ||
      row.proposed_status !== row.status || row.active_candidate_envelope === null) {
    return null;
  }
  const envelope = row.active_candidate_envelope;
  if ((envelope.contract !== "workbook-match-revision-candidate-v1" &&
       envelope.contract !== "workbook-match-revision-candidate-v2") ||
      !Array.isArray(envelope.rows)) {
    throw new EnginePersistenceInvariantError(
      "Active workbook candidate source rows are invalid."
    );
  }
  const playersBySideAndSlot = new Map<string, WorkbookGenerationSourcePlayerRecord>(teams.flatMap((team) =>
    team.players.map((player) => [
      `${team.sideNumber}:${player.rosterSlot}`,
      player
    ] as const)
  ));
  const rows = envelope.rows.map((value, index): CanonicalWorkbookSourceRow => {
    if (!isJsonObject(value) || (value.sideNumber !== 1 && value.sideNumber !== 2) ||
        !Number.isSafeInteger(value.worksheetRow) ||
        Number(value.worksheetRow) < 10 || Number(value.worksheetRow) > 89 ||
        !Number.isSafeInteger(value.rosterSlot) || Number(value.rosterSlot) < 1 ||
        !(value.shotNumber === null || (
          Number.isSafeInteger(value.shotNumber) && Number(value.shotNumber) > 0
        )) || !isJsonObject(value.markers)) {
      throw new EnginePersistenceInvariantError(
        `Active workbook candidate source row ${index + 1} is invalid.`
      );
    }
    const participant = playersBySideAndSlot.get(
      `${value.sideNumber}:${Number(value.rosterSlot)}`
    );
    if (participant === undefined || value.playerId !== participant.playerId ||
        value.rosterMembershipId !== participant.rosterMembershipId ||
        value.teamId !== teams[value.sideNumber - 1].teamId) {
      throw new EnginePersistenceInvariantError(
        "Active workbook candidate source participant is invalid."
      );
    }
    const markers = value.markers;
    const markerKeys = [
      "miss", "make", "splashOut", "guy", "tri", "di", "vom"
    ] as const;
    if (markerKeys.some((key) => typeof markers[key] !== "boolean")) {
      throw new EnginePersistenceInvariantError(
        "Active workbook candidate source markers are invalid."
      );
    }
    return {
      sideNumber: value.sideNumber as 1 | 2,
      worksheetRow: Number(value.worksheetRow),
      shotNumber: value.shotNumber === null ? null : Number(value.shotNumber),
      playerId: participant.playerId as never,
      rosterMembershipId: participant.rosterMembershipId as never,
      rosterSlot: Number(value.rosterSlot),
      markers: Object.fromEntries(markerKeys.map((key) => [key, markers[key]])) as {
        miss: boolean;
        make: boolean;
        splashOut: boolean;
        guy: boolean;
        tri: boolean;
        di: boolean;
        vom: boolean;
      }
    };
  });
  return { status: row.status === "final" ? "FINAL" : "LIVE GAME", rows };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapConfiguration(row: ConfigurationRow) {
  if (row.format_version !== TOURNAMENT_FORMAT_VERSION ||
      row.format_type !== POD_AND_SINGLE_ELIMINATION_FORMAT ||
      row.standings_rules.join("|") !== OFFICIAL_STANDINGS_RULES.join("|")) {
    throw new EnginePersistenceInvariantError(
      "Stored tournament configuration is unsupported."
    );
  }
  return copyTournamentConfiguration({
    formatVersion: TOURNAMENT_FORMAT_VERSION,
    formatType: POD_AND_SINGLE_ELIMINATION_FORMAT,
    teamCount: row.team_count,
    podCount: row.pod_count,
    podSizes: row.pod_sizes,
    playersPerTeam: row.players_per_team,
    gamesPerPair: row.games_per_pair,
    qualifiersPerPod: row.qualifiers_per_pod,
    bracketSize: row.bracket_size,
    allowByes: row.allow_byes,
    standingsRules: OFFICIAL_STANDINGS_RULES,
    ...(row.copied_from_preset_id === null
      ? {}
      : { copiedFromPresetId: row.copied_from_preset_id })
  });
}

function mapGeneratedWorkbook(
  row: GeneratedWorkbookRow,
  sheets: readonly GeneratedSheetRow[]
): GeneratedWorkbookArtifactRecord {
  return {
    workbookId: row.id,
    tournamentId: row.tournament_id as TournamentId,
    generationRevision: Number(row.generation_revision),
    workbookSchemaVersion: row.workbook_schema_version,
    generationKind: row.generation_kind,
    sourceTournamentRowVersion: Number(row.source_tournament_row_version),
    sourceDigest: row.source_digest,
    artifactDigest: row.artifact_digest,
    artifactSizeBytes: Number(row.artifact_size_bytes),
    artifact: row.artifact,
    filename: row.filename,
    generatedByAdminId: row.generated_by_admin_id,
    generatedAt: toIso(row.generated_at),
    sheets: sheets.map(mapGeneratedSheet)
  };
}

function mapGeneratedSheet(
  row: GeneratedSheetRow
): GeneratedWorkbookManifestSheetRecord {
  const hasParticipants = row.side_one_team_id !== null &&
    row.side_two_team_id !== null;
  return {
    sheetId: row.sheet_id,
    sheetOrdinal: row.sheet_ordinal,
    sheetKind: row.sheet_kind,
    sheetName: row.sheet_name,
    matchId: row.match_id,
    generatedMatchRowVersion: row.generated_match_row_version === null
      ? null
      : Number(row.generated_match_row_version),
    participantTeamIds: hasParticipants
      ? [requiredString(row.side_one_team_id), requiredString(row.side_two_team_id)]
      : null,
    participantDigest: row.participant_digest,
    baselineFingerprint: row.baseline_fingerprint
  };
}

function mapImportPreview(
  batch: ImportBatchRow,
  observations: readonly ImportObservationRow[],
  teams: readonly CandidateTeamRow[],
  players: readonly CandidatePlayerRow[]
): WorkbookImportPreviewRecord {
  return {
    batchId: batch.id,
    tournamentId: batch.tournament_id as TournamentId,
    workbookId: batch.workbook_id,
    supersedesBatchId: batch.supersedes_batch_id,
    workbookSchemaVersion: batch.workbook_schema_version,
    sourceWorkbookDigest: batch.source_workbook_digest,
    sourceSizeBytes: Number(batch.source_size_bytes),
    baseTournamentRowVersion: Number(batch.base_tournament_row_version),
    previewDigest: batch.preview_digest,
    status: batch.status,
    receivedByAdminId: batch.received_by_admin_id,
    receivedAt: toIso(batch.received_at),
    previewedAt: toIso(batch.previewed_at),
    previewExpiresAt: toIso(batch.preview_expires_at),
    confirmedByAdminId: batch.confirmed_by_admin_id,
    confirmedAt: toIsoNullable(batch.confirmed_at),
    completedAt: toIsoNullable(batch.completed_at),
    counts: {
      recognized: batch.recognized_sheet_count,
      proposed: batch.proposed_sheet_count,
      unchanged: batch.unchanged_sheet_count,
      missing: batch.missing_sheet_count,
      invalid: batch.invalid_sheet_count
    },
    observations: observations.map((observation) =>
      mapObservation(observation, teams, players)
    )
  };
}

function mapObservation(
  row: ImportObservationRow,
  teams: readonly CandidateTeamRow[],
  players: readonly CandidatePlayerRow[]
): WorkbookImportObservationRecord {
  const candidateTeams = row.candidate_id === null
    ? []
    : teams.filter((team) => team.candidate_id === row.candidate_id)
      .map((team) => ({
        sideNumber: team.side_number,
        teamId: team.team_id,
        displayName: team.display_name_at_import,
        players: players.filter((player) =>
          player.candidate_id === team.candidate_id &&
          player.side_number === team.side_number
        ).map((player) => ({
          playerId: player.player_id,
          rosterMembershipId: player.roster_membership_id,
          rosterSlot: player.roster_slot,
          displayName: player.display_name_at_import
        }))
      }));
  const candidate = row.candidate_id === null ? null : {
    candidateId: row.candidate_id,
    matchId: requiredString(row.match_id),
    ...(row.previous_applied_candidate_id === null
      ? {}
      : { previousAppliedCandidateId: row.previous_applied_candidate_id }),
    sourceRevisionNumber: Number(row.source_revision_number),
    fingerprint: requiredString(row.candidate_fingerprint),
    proposedStatus: requiredValue(row.proposed_status),
    proposedScoreAvailability: requiredValue(
      row.proposed_score_availability
    ),
    reason: requiredValue(row.reason),
    requiresConfirmation: row.requires_confirmation === true,
    expectedMatchRowVersion: Number(row.candidate_base_match_row_version),
    expectedSourceStateVersion: Number(row.candidate_base_source_state_version),
    envelopeSchemaVersion: Number(row.envelope_schema_version),
    envelope: requiredValue(row.envelope),
    envelopeDigest: requiredString(row.envelope_digest),
    participantDigest: requiredString(row.participant_digest),
    teams: candidateTeams
  } satisfies WorkbookRevisionCandidateInput;
  return {
    observationId: row.id,
    observationKind: row.observation_kind,
    sheetOrdinal: row.sheet_ordinal,
    workbookSheetId: row.workbook_sheet_id,
    matchId: row.match_id,
    assignmentSource: row.assignment_source,
    disposition: row.disposition,
    fingerprint: row.fingerprint,
    baseMatchRowVersion: row.base_match_row_version === null
      ? null
      : Number(row.base_match_row_version),
    baseSourceStateVersion: Number(row.base_source_state_version),
    sourceEnvelopeSchemaVersion: row.source_envelope_schema_version,
    sourceEnvelopeDigest: row.source_envelope_digest,
    sourceEnvelope: row.source_envelope,
    validationIssues: row.validation_issues,
    candidate
  };
}

function validateGeneratedWorkbookInput(input: StoreGeneratedWorkbookInput): void {
  positiveInteger(input.generationRevision, "Generation revision");
  positiveInteger(input.workbookSchemaVersion, "Workbook schema version");
  positiveInteger(input.sourceTournamentRowVersion, "Tournament row version");
  validateDigest(input.sourceDigest, "Workbook source digest");
  validateDigest(input.artifactDigest, "Workbook artifact digest");
  const actualDigest = createHash("sha256").update(input.artifact).digest("hex");
  if (actualDigest !== input.artifactDigest) {
    throw new EnginePersistenceInvariantError(
      "Workbook artifact digest does not match its bytes."
    );
  }
  if (input.artifact.byteLength === 0 || input.artifact.byteLength > 52_428_800) {
    throw new EnginePersistenceInvariantError(
      "Generated workbook artifact size is invalid."
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.xlsx$/.test(input.filename)) {
    throw new EnginePersistenceInvariantError(
      "Generated workbook filename is invalid."
    );
  }
  assertUniqueIds(input.sheets.map((sheet) => sheet.sheetId), "Workbook sheets");
  assertUniqueNumbers(
    input.sheets.map((sheet) => sheet.sheetOrdinal),
    "Workbook sheet ordinals"
  );
  for (const sheet of input.sheets) {
    positiveInteger(sheet.sheetOrdinal, "Workbook sheet ordinal");
    if (sheet.baselineFingerprint !== null) {
      validateDigest(sheet.baselineFingerprint, "Sheet baseline fingerprint");
    }
    if (sheet.sheetKind === "game") {
      positiveInteger(sheet.generatedMatchRowVersion, "Generated match version");
      validateDigest(sheet.participantDigest, "Sheet participant digest");
    }
  }
}

function validatePreviewInput(input: CreateWorkbookImportPreviewInput): void {
  validateDigest(input.sourceWorkbookDigest, "Source workbook digest");
  validateDigest(input.previewDigest, "Preview digest");
  positiveInteger(input.workbookSchemaVersion, "Workbook schema version");
  positiveInteger(input.sourceSizeBytes, "Source workbook size");
  positiveInteger(input.baseTournamentRowVersion, "Tournament row version");
  validTimestamp(input.receivedAt, "Workbook received time");
  validTimestamp(input.previewedAt, "Workbook preview time");
  if (Date.parse(input.receivedAt) > Date.parse(input.previewedAt)) {
    throw new EnginePersistenceInvariantError(
      "Workbook preview cannot precede receipt."
    );
  }
  assertUniqueIds(
    input.observations.map((item) => item.observationId),
    "Workbook observations"
  );
  for (const observation of input.observations) {
    validateObservationIssues(observation.validationIssues);
  }
  const ordinals = input.observations.flatMap((item) =>
    item.observationKind === "present" ? [item.sheetOrdinal] : []
  );
  assertUniqueNumbers(ordinals, "Workbook observation ordinals");
}

function validateRevisionInput(input: ReviseWorkbookImportPreviewInput): void {
  validateDigest(input.previewDigest, "Preview digest");
  validTimestamp(input.previewedAt, "Workbook preview revision time");
  assertUniqueIds(
    input.observations.map((item) => item.observationId),
    "Workbook observations"
  );
  for (const observation of input.observations) {
    validateObservationIssues(observation.validationIssues);
  }
}

function validateCandidate(
  candidate: WorkbookRevisionCandidateInput,
  observation: Extract<WorkbookImportObservationInput, {
    observationKind: "present";
  }>
): void {
  if (candidate.matchId !== observation.matchId ||
      candidate.fingerprint !== observation.fingerprint ||
      candidate.expectedMatchRowVersion !== observation.baseMatchRowVersion ||
      candidate.expectedSourceStateVersion !== observation.baseSourceStateVersion) {
    throw new EnginePersistenceInvariantError(
      "Workbook candidate header does not match its observation."
    );
  }
  positiveInteger(candidate.sourceRevisionNumber, "Source revision number");
  positiveInteger(candidate.envelopeSchemaVersion, "Envelope schema version");
  validateDigest(candidate.fingerprint, "Candidate fingerprint");
  validateDigest(candidate.envelopeDigest, "Candidate envelope digest");
  validateDigest(candidate.participantDigest, "Candidate participant digest");
  if (digestWorkbookValue(candidate.envelope) !== candidate.envelopeDigest) {
    throw new EnginePersistenceInvariantError(
      "Workbook candidate envelope digest does not match."
    );
  }
  if (digestWorkbookParticipants(candidate.teams) !== candidate.participantDigest) {
    throw new EnginePersistenceInvariantError(
      "Workbook candidate participant digest does not match."
    );
  }
  const sides = candidate.teams.map((team) => team.sideNumber).sort();
  if (candidate.teams.length !== 2 || sides[0] !== 1 || sides[1] !== 2 ||
      candidate.teams[0]?.teamId === candidate.teams[1]?.teamId) {
    throw new EnginePersistenceInvariantError(
      "Workbook candidate requires two distinct participant sides."
    );
  }
}

function observationCounts(
  observations: readonly WorkbookImportObservationInput[]
): WorkbookImportPreviewRecord["counts"] {
  return {
    recognized: observations.filter((item) => item.observationKind === "present")
      .length,
    proposed: observations.filter((item) => item.disposition === "proposed").length,
    unchanged: observations.filter((item) => item.disposition === "unchanged").length,
    missing: observations.filter((item) => item.disposition === "missing").length,
    invalid: observations.filter((item) =>
      item.disposition === "invalid" || item.disposition === "ambiguous"
    ).length
  };
}

function validateObservationIssues(
  issues: readonly WorkbookObservationValidationIssue[]
): void {
  if (issues.length > 100 || issues.some((issue) =>
    !/^[A-Z][A-Z0-9_]{1,79}$/.test(issue.code) ||
    !["warning", "error"].includes(issue.severity) ||
    issue.message.trim().length === 0 || issue.message.length > 500 ||
    (issue.path !== undefined && (
      issue.path.length === 0 || issue.path.length > 240
    ))
  )) {
    throw new EnginePersistenceInvariantError(
      "Workbook observation validation issues are invalid."
    );
  }
}

function assertSameNormalizedSource(
  previous: readonly ImportObservationRow[],
  revised: readonly WorkbookImportObservationInput[]
): void {
  const previousPresent = new Map(previous.flatMap((item) =>
    item.observation_kind === "present" && item.sheet_ordinal !== null
      ? [[item.sheet_ordinal, item.source_envelope_digest] as const]
      : []
  ));
  const revisedPresent = new Map(revised.flatMap((item) =>
    item.observationKind === "present"
      ? [[item.sheetOrdinal, item.sourceEnvelopeDigest] as const]
      : []
  ));
  if (previousPresent.size !== revisedPresent.size ||
      [...previousPresent].some(([ordinal, digest]) =>
        revisedPresent.get(ordinal) !== digest
      )) {
    throw new EnginePersistenceConflictError(
      "Revised preview must retain every normalized uploaded sheet unchanged."
    );
  }
}

function assertCompletePartition(
  proposals: ReadonlySet<string>,
  accepted: ReadonlySet<string>,
  skipped: ReadonlySet<string>
): void {
  if ([...accepted].some((id) => skipped.has(id)) ||
      [...accepted].some((id) => !proposals.has(id)) ||
      [...skipped].some((id) => !proposals.has(id)) ||
      [...proposals].some((id) => !accepted.has(id) && !skipped.has(id))) {
    throw new EnginePersistenceInvariantError(
      "Accepted and skipped observations must partition every proposal exactly."
    );
  }
}

function compareObservations(
  first: WorkbookImportObservationInput,
  second: WorkbookImportObservationInput
): number {
  const firstOrdinal = first.observationKind === "present"
    ? first.sheetOrdinal
    : Number.MAX_SAFE_INTEGER;
  const secondOrdinal = second.observationKind === "present"
    ? second.sheetOrdinal
    : Number.MAX_SAFE_INTEGER;
  return firstOrdinal - secondOrdinal ||
    (first.matchId ?? "").localeCompare(second.matchId ?? "") ||
    first.observationId.localeCompare(second.observationId);
}

function scopedId(namespace: string, ...parts: readonly string[]): string {
  return createUuidV5(namespace, parts.join("|"));
}

function observationBatchIdRequired(observation: ImportObservationRow): string {
  return observation.batch_id;
}

function requiredMatchId(observation: ImportObservationRow): string {
  if (observation.match_id === null) {
    throw new EnginePersistenceInvariantError(
      "Workbook observation requires stable match identity."
    );
  }
  return observation.match_id;
}

function positiveMetadataInteger(
  metadata: Record<string, unknown>,
  key: string
): number {
  const value = metadata[key];
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new EnginePersistenceInvariantError(
      `Scheduled match metadata '${key}' must be a positive integer.`
    );
  }
  return Number(value);
}

function validateDigest(value: string, label: string): void {
  if (!SHA256.test(value)) {
    throw new EnginePersistenceInvariantError(`${label} must be SHA-256.`);
  }
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new EnginePersistenceInvariantError(`${label} must be positive.`);
  }
}

function validTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new EnginePersistenceInvariantError(`${label} must be valid.`);
  }
}

function assertUniqueIds(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new EnginePersistenceInvariantError(`${label} must be unique.`);
  }
}

function assertUniqueNumbers(values: readonly number[], label: string): void {
  if (values.some((value) => !Number.isSafeInteger(value) || value <= 0) ||
      new Set(values).size !== values.length) {
    throw new EnginePersistenceInvariantError(
      `${label} must be unique positive integers.`
    );
  }
}

function requiredString(value: string | null): string {
  if (value === null) {
    throw new EnginePersistenceInvariantError(
      "Stored workbook reconciliation value is missing."
    );
  }
  return value;
}

function requiredValue<T>(value: T | null): T {
  if (value === null) {
    throw new EnginePersistenceInvariantError(
      "Stored workbook reconciliation value is missing."
    );
  }
  return value;
}

async function readServerTime(executor: EnginePostgresExecutor): Promise<string> {
  const result = await executor.query<{ server_time: Date | string }>(
    "SELECT clock_timestamp() AS server_time"
  );
  return toIso(requiredValue(result.rows[0]?.server_time ?? null));
}

function toIso(value: Date | string | null): string {
  if (value === null) {
    throw new EnginePersistenceInvariantError(
      "Stored workbook timestamp is missing."
    );
  }
  return new Date(value).toISOString();
}

function toIsoNullable(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
