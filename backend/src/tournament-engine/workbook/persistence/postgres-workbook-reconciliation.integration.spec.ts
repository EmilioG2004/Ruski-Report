import { createHash, randomUUID } from "node:crypto";

import { loadDatabaseConfig } from "../../../config/database.config";
import { MigrationRunner, PostgresDatabase } from "../../../database";
import { parseStableUuid } from "../../domain";
import { PostgresMatchWriterRepository } from "../../persistence";
import {
  CreateWorkbookImportPreviewInput,
  digestWorkbookParticipants,
  digestWorkbookValue,
  GeneratedWorkbookSheetInput,
  StoreGeneratedWorkbookInput,
  WorkbookImportObservationInput,
  WorkbookRevisionCandidateInput,
  WorkbookRevisionCandidateTeamInput
} from "./contracts";
import { PostgresWorkbookReconciliationRepository } from "./postgres-workbook-reconciliation.repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;

postgresDescribe("workbook reconciliation PostgreSQL persistence", () => {
  let database: PostgresDatabase;
  let repository: PostgresWorkbookReconciliationRepository;
  let writers: PostgresMatchWriterRepository;

  beforeAll(async () => {
    const config = loadDatabaseConfig({
      DATABASE_URL: databaseUrl,
      DATABASE_MIGRATIONS_DIR: `${process.cwd()}/migrations`
    });
    database = new PostgresDatabase(config);
    await new MigrationRunner(database, config).migrate();
    writers = new PostgresMatchWriterRepository(database);
    repository = new PostgresWorkbookReconciliationRepository(
      database,
      undefined,
      writers
    );
  });

  beforeEach(async () => {
    await database.query("TRUNCATE engine_tournaments, admin_accounts CASCADE");
  });

  afterAll(async () => {
    await database.onApplicationShutdown();
  });

  it("stores an exact generated artifact idempotently by source", async () => {
    const fixture = await seedPublishedTournament(database);
    const source = await repository.readGenerationSource(fixture.tournamentId);
    expect(source).not.toBeNull();
    expect(source).toMatchObject({
      nextGenerationRevision: 1,
      tournament: { rowVersion: 2 }
    });
    expect(source?.pods.map((pod) => pod.sequence)).toEqual([1, 2]);
    expect(source?.teams[0]).toMatchObject({ sequence: 1, initialSeed: 1 });
    expect(source?.matches[0]).toMatchObject({
      sequenceInPod: 1,
      roundNumber: 1,
      gameNumberForPair: 1
    });

    const generation = generatedWorkbook(fixture);
    const stored = await repository.storeGeneratedWorkbook(generation);
    expect(stored.created).toBe(true);
    expect(stored.workbook.artifact.equals(generation.artifact)).toBe(true);
    expect(stored.workbook.sheets).toHaveLength(4);
    expect(stored.workbook.sheets[2]).toMatchObject({
      matchId: fixture.matchIds[0],
      baselineFingerprint: digest("baseline-1")
    });

    const repeated = await repository.storeGeneratedWorkbook({
      ...generation,
      workbookId: randomUUID(),
      audit: { eventId: randomUUID() }
    });
    expect(repeated).toMatchObject({
      created: false,
      workbook: { workbookId: generation.workbookId, generationRevision: 1 }
    });
    expect(await repository.listGeneratedWorkbooks(fixture.tournamentId))
      .toEqual([expect.objectContaining({
        workbookId: generation.workbookId,
        generationRevision: 1,
        sheetCount: 4
      })]);
    expect((await repository.readGenerationSource(fixture.tournamentId))
      ?.nextGenerationRevision).toBe(2);
  });

  it("rejects publishing a setup that exceeds workbook sheet capacity", async () => {
    const tournamentId = parseStableUuid(randomUUID(), "tournament");
    await database.query(`
      INSERT INTO tournaments (id, game_type, year, name)
      VALUES ($1, 'ruski', 2032, 'Oversized workbook setup')
    `, [tournamentId]);
    await database.query(`
      INSERT INTO engine_tournaments (
        id, public_key, game_type, year, name, lifecycle, visibility
      ) VALUES (
        $1::uuid, $1, 'ruski', 2032, 'Oversized workbook setup',
        'draft_setup', 'private'
      )
    `, [tournamentId]);
    await database.query(`
      INSERT INTO engine_tournament_configurations (
        tournament_id, format_version, format_type, team_count, pod_count,
        pod_sizes, players_per_team, games_per_pair, qualifiers_per_pod,
        bracket_size, allow_byes, standings_rules
      ) VALUES (
        $1::uuid, 1, 'pod_and_single_elimination', 24, 1,
        ARRAY[24]::smallint[], 1, 1, 1, 2, true,
        ARRAY['record','cupDifferential','teamShootingPercentage',
              'administratorResolution']::text[]
      )
    `, [tournamentId]);

    await expect(database.query(`
      UPDATE engine_tournaments
      SET lifecycle = 'setup_published', setup_published_at = now(),
          row_version = row_version + 1, updated_at = now()
      WHERE id = $1::uuid
    `, [tournamentId])).rejects.toThrow(/game-sheet capacity/i);
    expect(await database.query<{ lifecycle: string }>(`
      SELECT lifecycle
      FROM engine_tournaments
      WHERE id = $1::uuid
    `, [tournamentId])).toMatchObject({
      rows: [{ lifecycle: "draft_setup" }]
    });
  });

  it("applies one candidate, audits a missing sheet, then no-ops identically", async () => {
    const fixture = await seedPublishedTournament(database);
    const generation = generatedWorkbook(fixture);
    await repository.storeGeneratedWorkbook(generation);
    const candidate = candidateFor(fixture, 0, {
      sourceRevisionNumber: 1,
      fingerprint: digest("match-1-live"),
      reason: "initial"
    });
    const preview = await repository.createImportPreview(previewInput(
      fixture,
      generation,
      [
        proposedObservation(generation.sheets[2], fixture.matchIds[0], candidate),
        missingObservation(generation.sheets[3], fixture.matchIds[1])
      ]
    ));
    const proposed = preview.observations.find((item) =>
      item.disposition === "proposed"
    );
    if (proposed === undefined) {
      throw new Error("Fixture proposal was not stored.");
    }
    const applied = await repository.confirmImport({
      tournamentId: fixture.tournamentId,
      batchId: preview.batchId,
      previewDigest: preview.previewDigest,
      acceptedObservationIds: [proposed.observationId],
      skippedObservationIds: [],
      confirmedByAdminId: fixture.adminId,
      audit: { eventId: randomUUID() }
    });
    expect(applied).toMatchObject({
      status: "applied",
      appliedMatchIds: [fixture.matchIds[0]],
      missingMatchIds: [fixture.matchIds[1]]
    });
    expect(await count(database, "engine_match_revisions")).toBe(0);
    expect(await database.query(`
      SELECT row_version::text, active_fingerprint
      FROM engine_match_workbook_source_states
      WHERE match_id = $1::uuid
    `, [fixture.matchIds[0]])).toMatchObject({
      rows: [{ row_version: "1", active_fingerprint: candidate.fingerprint }]
    });

    const noOpPreview = await repository.createImportPreview(previewInput(
      fixture,
      generation,
      [
        unchangedObservation(
          generation.sheets[2],
          fixture.matchIds[0],
          candidate.fingerprint,
          1
        ),
        missingObservation(generation.sheets[3], fixture.matchIds[1])
      ]
    ));
    const noOp = await repository.confirmImport({
      tournamentId: fixture.tournamentId,
      batchId: noOpPreview.batchId,
      previewDigest: noOpPreview.previewDigest,
      acceptedObservationIds: [],
      skippedObservationIds: [],
      confirmedByAdminId: fixture.adminId,
      audit: { eventId: randomUUID() }
    });
    expect(noOp.status).toBe("no_op");
    expect(await count(database, "engine_match_workbook_source_states")).toBe(1);
  });

  it("reads frozen candidate rosters but current rosters for unplayed matches", async () => {
    const fixture = await seedPublishedTournament(database);
    const generation = generatedWorkbook(fixture);
    await repository.storeGeneratedWorkbook(generation);
    const historical = candidateFor(fixture, 0, {
      sourceRevisionNumber: 1,
      fingerprint: digest("historical-roster"),
      reason: "initial",
      useHistoricalPlayer: true
    });
    const preview = await repository.createImportPreview(previewInput(
      fixture,
      generation,
      [proposedObservation(generation.sheets[2], fixture.matchIds[0], historical)]
    ));
    await repository.confirmImport({
      tournamentId: fixture.tournamentId,
      batchId: preview.batchId,
      previewDigest: preview.previewDigest,
      acceptedObservationIds: [preview.observations[0].observationId],
      skippedObservationIds: [],
      confirmedByAdminId: fixture.adminId,
      audit: { eventId: randomUUID() }
    });

    const source = await repository.readGenerationSource(fixture.tournamentId);
    expect(source?.matches[0].participantTeams[0].players[0]).toMatchObject({
      playerId: fixture.historicalPlayerIds[0],
      rosterMembershipId: fixture.historicalMembershipIds[0],
      displayName: "Historical Player 1"
    });
    expect(source?.matches[1].participantTeams[0].players[0]).toMatchObject({
      playerId: fixture.playerIds[2],
      rosterMembershipId: fixture.membershipIds[2],
      displayName: "Player 3"
    });
  });

  it("allows live updates without a reason but requires one for corrections", async () => {
    const fixture = await seedPublishedTournament(database);
    const generation = generatedWorkbook(fixture);
    await repository.storeGeneratedWorkbook(generation);
    const initial = candidateFor(fixture, 0, {
      sourceRevisionNumber: 1,
      fingerprint: digest("live-initial"),
      reason: "initial"
    });
    const first = await repository.createImportPreview(previewInput(
      fixture,
      generation,
      [proposedObservation(generation.sheets[2], fixture.matchIds[0], initial)]
    ));
    await repository.confirmImport({
      tournamentId: fixture.tournamentId,
      batchId: first.batchId,
      previewDigest: first.previewDigest,
      acceptedObservationIds: [first.observations[0].observationId],
      skippedObservationIds: [],
      confirmedByAdminId: fixture.adminId,
      audit: { eventId: randomUUID() }
    });
    const firstCandidateId = (await repository.readGenerationSource(
      fixture.tournamentId
    ))?.matches[0].workbookState?.activeCandidateId;
    if (firstCandidateId === undefined) {
      throw new Error("Initial workbook candidate was not active.");
    }
    const liveUpdate = candidateFor(fixture, 0, {
      sourceRevisionNumber: 2,
      fingerprint: digest("live-update"),
      reason: "workbook_update",
      previousAppliedCandidateId: firstCandidateId,
      proposedStatus: "in_progress",
      proposedScoreAvailability: "partial"
    });
    const second = await repository.createImportPreview(previewInput(
      fixture,
      generation,
      [proposedObservation(
        generation.sheets[2],
        fixture.matchIds[0],
        liveUpdate,
        1
      )]
    ));
    await expect(repository.confirmImport({
      tournamentId: fixture.tournamentId,
      batchId: second.batchId,
      previewDigest: second.previewDigest,
      acceptedObservationIds: [second.observations[0].observationId],
      skippedObservationIds: [],
      confirmedByAdminId: fixture.adminId,
      audit: { eventId: randomUUID() }
    })).resolves.toMatchObject({ status: "applied" });

    const secondCandidateId = (await repository.readGenerationSource(
      fixture.tournamentId
    ))?.matches[0].workbookState?.activeCandidateId;
    if (secondCandidateId === undefined) {
      throw new Error("Live workbook candidate was not active.");
    }
    const correction = candidateFor(fixture, 0, {
      sourceRevisionNumber: 3,
      fingerprint: digest("final-correction"),
      reason: "correction",
      previousAppliedCandidateId: secondCandidateId
    });
    const third = await repository.createImportPreview(previewInput(
      fixture,
      generation,
      [proposedObservation(
        generation.sheets[2],
        fixture.matchIds[0],
        correction,
        2
      )]
    ));
    await expect(repository.confirmImport({
      tournamentId: fixture.tournamentId,
      batchId: third.batchId,
      previewDigest: third.previewDigest,
      acceptedObservationIds: [third.observations[0].observationId],
      skippedObservationIds: [],
      confirmedByAdminId: fixture.adminId,
      audit: { eventId: randomUUID() }
    })).rejects.toThrow(/reason/i);
    await expect(repository.confirmImport({
      tournamentId: fixture.tournamentId,
      batchId: third.batchId,
      previewDigest: third.previewDigest,
      acceptedObservationIds: [third.observations[0].observationId],
      skippedObservationIds: [],
      correctionReasons: {
        [third.observations[0].observationId]: "Correct the final source rows"
      },
      confirmedByAdminId: fixture.adminId,
      audit: { eventId: randomUUID() }
    })).resolves.toMatchObject({ status: "applied" });
  });

  it("keeps a two-match preview retryable when the second writer conflicts", async () => {
    const fixture = await seedPublishedTournament(database);
    const generation = generatedWorkbook(fixture);
    await repository.storeGeneratedWorkbook(generation);
    const candidates = [0, 1].map((matchIndex) => candidateFor(
      fixture,
      matchIndex,
      {
        sourceRevisionNumber: 1,
        fingerprint: digest(`writer-${matchIndex}`),
        reason: "initial"
      }
    ));
    const preview = await repository.createImportPreview(previewInput(
      fixture,
      generation,
      candidates.map((candidate, index) => proposedObservation(
        generation.sheets[index + 2],
        fixture.matchIds[index],
        candidate
      ))
    ));
    const now = new Date();
    const conflictMatchId = [...fixture.matchIds].sort()[1];
    const liveLease = await writers.acquire({
      tournamentId: fixture.tournamentId,
      matchId: parseStableUuid(conflictMatchId, "match"),
      mode: "in_app_live",
      holderId: "live-writer",
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 300_000).toISOString()
    });
    expect(liveLease.acquired).toBe(true);

    await expect(repository.confirmImport({
      tournamentId: fixture.tournamentId,
      batchId: preview.batchId,
      previewDigest: preview.previewDigest,
      acceptedObservationIds: preview.observations.map((item) => item.observationId),
      skippedObservationIds: [],
      confirmedByAdminId: fixture.adminId,
      audit: { eventId: randomUUID() }
    })).rejects.toThrow(/writer/i);
    expect(await count(database, "engine_match_workbook_source_states")).toBe(0);
    expect(await count(database, "engine_workbook_import_decisions")).toBe(0);
    expect((await repository.findImportPreview(
      fixture.tournamentId,
      preview.batchId
    ))?.status).toBe("preview_ready");
    const leases = await database.query<{ holder_id: string }>(
      "SELECT holder_id FROM engine_match_writer_leases ORDER BY holder_id"
    );
    expect(leases.rows).toEqual([{ holder_id: "live-writer" }]);
  });

  it("applies an explicit subset and database guards keep history forward-only", async () => {
    const fixture = await seedPublishedTournament(database);
    const generation = generatedWorkbook(fixture);
    await repository.storeGeneratedWorkbook(generation);
    const candidates = [0, 1].map((matchIndex) => candidateFor(
      fixture,
      matchIndex,
      {
        sourceRevisionNumber: 1,
        fingerprint: digest(`subset-${matchIndex}`),
        reason: "initial"
      }
    ));
    const preview = await repository.createImportPreview(previewInput(
      fixture,
      generation,
      candidates.map((candidate, index) => proposedObservation(
        generation.sheets[index + 2],
        fixture.matchIds[index],
        candidate
      ))
    ));
    const applied = await repository.confirmImport({
      tournamentId: fixture.tournamentId,
      batchId: preview.batchId,
      previewDigest: preview.previewDigest,
      acceptedObservationIds: [preview.observations[0].observationId],
      skippedObservationIds: [preview.observations[1].observationId],
      confirmedByAdminId: fixture.adminId,
      audit: { eventId: randomUUID() }
    });
    expect(applied).toMatchObject({
      appliedMatchIds: [fixture.matchIds[0]],
      skippedMatchIds: [fixture.matchIds[1]]
    });
    expect(await count(database, "engine_match_workbook_source_states")).toBe(1);
    const decisions = await database.query<{ decision: string }>(`
      SELECT decision
      FROM engine_workbook_import_decisions
      ORDER BY decision
    `);
    expect(decisions.rows).toEqual([
      { decision: "accepted" },
      { decision: "skipped" }
    ]);

    await expect(database.query(`
      UPDATE engine_match_workbook_source_states
      SET row_version = row_version + 2
      WHERE match_id = $1::uuid
    `, [fixture.matchIds[0]])).rejects.toThrow(/advance one/i);
    await expect(database.query(`
      UPDATE engine_workbook_revision_candidates
      SET fingerprint = $2
      WHERE match_id = $1::uuid
    `, [fixture.matchIds[0], digest("rewritten")])).rejects.toThrow(/immutable/i);
    await expect(database.query(`
      UPDATE engine_workbook_import_batches
      SET status = 'preview_ready', confirmed_by_admin_id = NULL,
          confirmed_at = NULL, completed_at = NULL
      WHERE id = $1::uuid
    `, [preview.batchId])).rejects.toThrow(/transition/i);
  });

  it("rejects candidate teams that do not match stable match slots", async () => {
    const fixture = await seedPublishedTournament(database);
    const generation = generatedWorkbook(fixture);
    await repository.storeGeneratedWorkbook(generation);
    const candidate = candidateFor(fixture, 0, {
      sourceRevisionNumber: 1,
      fingerprint: digest("slot-integrity"),
      reason: "initial"
    });
    const reversedTeams = candidate.teams.map((team) => ({
      ...team,
      sideNumber: team.sideNumber === 1 ? 2 as const : 1 as const
    }));
    const mismatched = {
      ...candidate,
      teams: reversedTeams,
      participantDigest: digestWorkbookParticipants(reversedTeams)
    };
    await expect(repository.createImportPreview(previewInput(
      fixture,
      generation,
      [proposedObservation(
        generation.sheets[2],
        fixture.matchIds[0],
        mismatched
      )]
    ))).rejects.toThrow(/stable match slots/i);
    expect(await count(database, "engine_workbook_revision_candidates")).toBe(0);

    const validPreview = await repository.createImportPreview(previewInput(
      fixture,
      generation,
      [proposedObservation(
        generation.sheets[2],
        fixture.matchIds[0],
        candidate
      )]
    ));
    const directBatchId = randomUUID();
    const directObservationId = randomUUID();
    const directCandidateId = randomUUID();
    await database.query(`
      INSERT INTO engine_workbook_import_batches (
        id, tournament_id, workbook_id, workbook_schema_version,
        source_workbook_digest, source_size_bytes,
        base_tournament_row_version, preview_digest, status,
        supersedes_batch_id, recognized_sheet_count, proposed_sheet_count,
        unchanged_sheet_count, missing_sheet_count, invalid_sheet_count,
        received_by_admin_id, received_at, previewed_at, preview_expires_at,
        confirmed_by_admin_id, confirmed_at, completed_at
      )
      SELECT $2::uuid, tournament_id, workbook_id, workbook_schema_version,
             source_workbook_digest, source_size_bytes,
             base_tournament_row_version, preview_digest, status,
             NULL, recognized_sheet_count, proposed_sheet_count,
             unchanged_sheet_count, missing_sheet_count, invalid_sheet_count,
             received_by_admin_id, received_at, previewed_at, preview_expires_at,
             NULL, NULL, NULL
      FROM engine_workbook_import_batches
      WHERE id = $1::uuid
    `, [validPreview.batchId, directBatchId]);
    await database.query(`
      INSERT INTO engine_workbook_import_observations (
        id, tournament_id, batch_id, workbook_id, workbook_sheet_id,
        sheet_ordinal, match_id, observation_kind, assignment_source,
        disposition, fingerprint, base_match_row_version,
        base_source_state_version, source_envelope_schema_version,
        source_envelope_digest, source_envelope, validation_issues, observed_at
      )
      SELECT $2::uuid, tournament_id, $3::uuid, workbook_id, workbook_sheet_id,
             sheet_ordinal, match_id, observation_kind, assignment_source,
             disposition, fingerprint, base_match_row_version,
             base_source_state_version, source_envelope_schema_version,
             source_envelope_digest, source_envelope, validation_issues, observed_at
      FROM engine_workbook_import_observations
      WHERE batch_id = $1::uuid
    `, [validPreview.batchId, directObservationId, directBatchId]);
    await database.query(`
      INSERT INTO engine_workbook_revision_candidates (
        id, tournament_id, match_id, batch_id, observation_id,
        previous_applied_candidate_id, source_revision_number, fingerprint,
        participant_digest, proposed_status, proposed_score_availability,
        reason, requires_confirmation, envelope_schema_version,
        envelope_digest, envelope, base_match_row_version,
        base_source_state_version, created_at
      )
      SELECT $2::uuid, tournament_id, match_id, $3::uuid, $4::uuid,
             previous_applied_candidate_id, source_revision_number, fingerprint,
             participant_digest, proposed_status, proposed_score_availability,
             reason, requires_confirmation, envelope_schema_version,
             envelope_digest, envelope, base_match_row_version,
             base_source_state_version, created_at
      FROM engine_workbook_revision_candidates
      WHERE batch_id = $1::uuid
    `, [
      validPreview.batchId,
      directCandidateId,
      directBatchId,
      directObservationId
    ]);
    await expect(database.query(`
      INSERT INTO engine_workbook_revision_candidate_teams (
        tournament_id, candidate_id, side_number, team_id,
        display_name_at_import
      ) VALUES ($1::uuid, $2::uuid, 1, $3::uuid, 'Wrong stable side')
    `, [
      fixture.tournamentId,
      directCandidateId,
      fixture.teamIds[1]
    ])).rejects.toThrow(/stable match slot/i);
    await database.query(`
      INSERT INTO engine_workbook_revision_candidate_teams (
        tournament_id, candidate_id, side_number, team_id,
        display_name_at_import
      ) VALUES ($1::uuid, $2::uuid, 1, $3::uuid, 'Correct stable side')
    `, [
      fixture.tournamentId,
      directCandidateId,
      fixture.teamIds[0]
    ]);
    await expect(database.query(`
      INSERT INTO engine_match_workbook_source_states (
        tournament_id, match_id, active_candidate_id,
        active_fingerprint, participant_digest, source_batch_id,
        source_observation_id, row_version, updated_at
      )
      SELECT tournament_id, match_id, id,
             fingerprint, participant_digest, batch_id,
             observation_id, 1, now()
      FROM engine_workbook_revision_candidates
      WHERE id = $1::uuid
    `, [directCandidateId])).rejects.toThrow(/both stable match teams/i);
  });

  it("revises a copied blank assignment without retaining upload bytes", async () => {
    const fixture = await seedPublishedTournament(database);
    const generation = generatedWorkbook(fixture);
    await repository.storeGeneratedWorkbook(generation);
    const sourceEnvelope = {
      schemaVersion: 1,
      rows: [{ row: 1, values: { copiedBlank: true } }]
    };
    const unresolved: WorkbookImportObservationInput = {
      observationId: randomUUID(),
      observationKind: "present",
      sheetOrdinal: generation.sheets[1].sheetOrdinal,
      workbookSheetId: generation.sheets[1].sheetId,
      assignmentSource: "none",
      disposition: "ambiguous",
      baseSourceStateVersion: 0,
      sourceEnvelopeSchemaVersion: 1,
      sourceEnvelope,
      sourceEnvelopeDigest: digestWorkbookValue(sourceEnvelope),
      validationIssues: [{
        code: "COPIED_BLANK_ASSIGNMENT_REQUIRED",
        severity: "error",
        message: "Choose the stable match for this copied blank sheet.",
        path: "sheets[1]"
      }]
    };
    const initial = await repository.createImportPreview(previewInput(
      fixture,
      generation,
      [unresolved]
    ));
    const candidate = candidateFor(fixture, 0, {
      sourceRevisionNumber: 1,
      fingerprint: digest("assigned-copy"),
      reason: "initial"
    });
    const revised = await repository.reviseImportPreview({
      batchId: randomUUID(),
      tournamentId: fixture.tournamentId,
      supersedesBatchId: initial.batchId,
      previewDigest: digest("revised-preview"),
      status: "preview_ready",
      revisedByAdminId: fixture.adminId,
      previewedAt: new Date().toISOString(),
      observations: [{
        ...unresolved,
        observationId: randomUUID(),
        matchId: fixture.matchIds[0],
        assignmentSource: "explicit_blank",
        disposition: "proposed",
        fingerprint: candidate.fingerprint,
        baseMatchRowVersion: 1,
        validationIssues: [{
          code: "SHOOTER_DISPLAY_MISMATCH",
          severity: "warning",
          message: "A workbook display label differs from the stable player."
        }],
        candidate
      }],
      audit: { eventId: randomUUID() }
    });
    expect(revised).toMatchObject({
      supersedesBatchId: initial.batchId,
      sourceWorkbookDigest: initial.sourceWorkbookDigest,
      sourceSizeBytes: initial.sourceSizeBytes,
      counts: { proposed: 1, invalid: 0 }
    });
    expect(revised.observations[0]).toMatchObject({
      assignmentSource: "explicit_blank",
      validationIssues: [{ code: "SHOOTER_DISPLAY_MISMATCH" }]
    });
    expect((await repository.findImportPreview(
      fixture.tournamentId,
      initial.batchId
    ))?.status).toBe("superseded");
    const uploadByteColumns = await database.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN (
          'engine_workbook_import_batches',
          'engine_workbook_import_observations'
        )
        AND data_type = 'bytea'
    `);
    expect(uploadByteColumns.rows).toEqual([{ count: "0" }]);
  });

  it("keeps a preview retryable when a match version becomes stale", async () => {
    const fixture = await seedPublishedTournament(database);
    const generation = generatedWorkbook(fixture);
    await repository.storeGeneratedWorkbook(generation);
    const candidate = candidateFor(fixture, 0, {
      sourceRevisionNumber: 1,
      fingerprint: digest("stale-match"),
      reason: "initial"
    });
    const preview = await repository.createImportPreview(previewInput(
      fixture,
      generation,
      [proposedObservation(generation.sheets[2], fixture.matchIds[0], candidate)]
    ));
    await database.query(`
      UPDATE engine_matches
      SET row_version = row_version + 1, updated_at = now()
      WHERE id = $1::uuid
    `, [fixture.matchIds[0]]);
    await expect(repository.confirmImport({
      tournamentId: fixture.tournamentId,
      batchId: preview.batchId,
      previewDigest: preview.previewDigest,
      acceptedObservationIds: [preview.observations[0].observationId],
      skippedObservationIds: [],
      confirmedByAdminId: fixture.adminId,
      audit: { eventId: randomUUID() }
    })).rejects.toThrow(/changed after preview/i);
    expect((await repository.findImportPreview(
      fixture.tournamentId,
      preview.batchId
    ))?.status).toBe("preview_ready");
    expect(await count(database, "engine_workbook_import_decisions")).toBe(0);
  });

  it("rejects stale digest, expired preview, and changed participants", async () => {
    const fixture = await seedPublishedTournament(database);
    const generation = generatedWorkbook(fixture);
    await repository.storeGeneratedWorkbook(generation);
    const initial = candidateFor(fixture, 0, {
      sourceRevisionNumber: 1,
      fingerprint: digest("participant-initial"),
      reason: "initial"
    });
    const first = await repository.createImportPreview(previewInput(
      fixture,
      generation,
      [proposedObservation(generation.sheets[2], fixture.matchIds[0], initial)]
    ));
    await expect(repository.confirmImport({
      tournamentId: fixture.tournamentId,
      batchId: first.batchId,
      previewDigest: digest("wrong-preview"),
      acceptedObservationIds: [first.observations[0].observationId],
      skippedObservationIds: [],
      confirmedByAdminId: fixture.adminId,
      audit: { eventId: randomUUID() }
    })).rejects.toThrow(/digest/i);
    await repository.confirmImport({
      tournamentId: fixture.tournamentId,
      batchId: first.batchId,
      previewDigest: first.previewDigest,
      acceptedObservationIds: [first.observations[0].observationId],
      skippedObservationIds: [],
      confirmedByAdminId: fixture.adminId,
      audit: { eventId: randomUUID() }
    });
    const source = await repository.readGenerationSource(fixture.tournamentId);
    const activeCandidateId = source?.matches[0].workbookState?.activeCandidateId;
    if (activeCandidateId === undefined) {
      throw new Error("Applied candidate was not available.");
    }
    const changed = candidateFor(fixture, 0, {
      sourceRevisionNumber: 2,
      fingerprint: digest("participant-changed"),
      reason: "correction",
      previousAppliedCandidateId: activeCandidateId,
      useHistoricalPlayer: true
    });
    const correction = await repository.createImportPreview(previewInput(
      fixture,
      generation,
      [proposedObservation(
        generation.sheets[2],
        fixture.matchIds[0],
        changed,
        1
      )]
    ));
    await expect(repository.confirmImport({
      tournamentId: fixture.tournamentId,
      batchId: correction.batchId,
      previewDigest: correction.previewDigest,
      acceptedObservationIds: [correction.observations[0].observationId],
      skippedObservationIds: [],
      correctionReasons: {
        [correction.observations[0].observationId]: "Correct source rows"
      },
      confirmedByAdminId: fixture.adminId,
      audit: { eventId: randomUUID() }
    })).rejects.toThrow(/participants/i);

    const old = new Date(Date.now() - 26 * 60 * 60 * 1_000);
    const expiredInput = previewInput(
      fixture,
      generation,
      [missingObservation(generation.sheets[3], fixture.matchIds[1])]
    );
    expiredInput.receivedAt = new Date(old.getTime() - 60_000).toISOString();
    expiredInput.previewedAt = old.toISOString();
    const expired = await repository.createImportPreview(expiredInput);
    await expect(repository.confirmImport({
      tournamentId: fixture.tournamentId,
      batchId: expired.batchId,
      previewDigest: expired.previewDigest,
      acceptedObservationIds: [],
      skippedObservationIds: [],
      confirmedByAdminId: fixture.adminId,
      audit: { eventId: randomUUID() }
    })).rejects.toThrow(/expired/i);
  });
});

interface Fixture {
  tournamentId: ReturnType<typeof parseStableUuid<"tournament">>;
  adminId: string;
  podIds: readonly [string, string];
  teamIds: readonly [string, string, string, string];
  playerIds: readonly [string, string, string, string];
  historicalPlayerIds: readonly [string, string, string, string];
  membershipIds: readonly [string, string, string, string];
  historicalMembershipIds: readonly [string, string, string, string];
  matchIds: readonly [string, string];
}

async function seedPublishedTournament(
  database: PostgresDatabase
): Promise<Fixture> {
  const tournamentId = parseStableUuid(randomUUID(), "tournament");
  const adminId = randomUUID();
  const podIds = [randomUUID(), randomUUID()] as const;
  const teamIds = Array.from({ length: 4 }, () => randomUUID()) as unknown as
    Fixture["teamIds"];
  const playerIds = Array.from({ length: 4 }, () => randomUUID()) as unknown as
    Fixture["playerIds"];
  const historicalPlayerIds = Array.from(
    { length: 4 },
    () => randomUUID()
  ) as unknown as Fixture["historicalPlayerIds"];
  const membershipIds = Array.from({ length: 4 }, () => randomUUID()) as unknown as
    Fixture["membershipIds"];
  const historicalMembershipIds = Array.from(
    { length: 4 },
    () => randomUUID()
  ) as unknown as Fixture["historicalMembershipIds"];
  const matchIds = [randomUUID(), randomUUID()] as const;
  const timestamp = new Date(Date.now() - 60_000).toISOString();
  const earlier = new Date(Date.parse(timestamp) - 120_000).toISOString();

  await database.query(`
    INSERT INTO admin_accounts (
      id, login_name, normalized_login_name, display_name
    ) VALUES ($1::uuid, 'phase3-admin', 'phase3-admin', 'Phase 3 Admin')
  `, [adminId]);
  await database.query(`
    INSERT INTO tournaments (id, game_type, year, name, created_at)
    VALUES ($1, 'ruski', 2031, 'Sanitized Phase 3 Tournament', $2)
  `, [tournamentId, timestamp]);
  await database.query(`
    INSERT INTO engine_tournaments (
      id, public_key, game_type, year, name, lifecycle, visibility,
      row_version, created_at, updated_at
    ) VALUES (
      $1::uuid, $1, 'ruski', 2031, 'Sanitized Phase 3 Tournament',
      'draft_setup', 'private', 1, $2, $2
    )
  `, [tournamentId, timestamp]);
  await database.query(`
    INSERT INTO engine_tournament_configurations (
      tournament_id, format_version, format_type, team_count, pod_count,
      pod_sizes, players_per_team, games_per_pair, qualifiers_per_pod,
      bracket_size, allow_byes, standings_rules
    ) VALUES (
      $1::uuid, 1, 'pod_and_single_elimination', 4, 2,
      ARRAY[2,2]::smallint[], 1, 1, 1,
      2, false,
      ARRAY['record','cupDifferential','teamShootingPercentage',
            'administratorResolution']::text[]
    )
  `, [tournamentId]);
  for (const [index, podId] of podIds.entries()) {
    await database.query(`
      INSERT INTO engine_pods (
        id, tournament_id, public_key, name, normalized_name, sequence
      ) VALUES ($1::uuid, $2::uuid, $1, $3, $4, $5)
    `, [podId, tournamentId, `Pod ${index + 1}`, `pod ${index + 1}`, index + 1]);
  }
  for (const [index, teamId] of teamIds.entries()) {
    const podIndex = Math.floor(index / 2);
    await database.query(`
      INSERT INTO engine_teams (
        id, tournament_id, public_key, name, normalized_name, sequence
      ) VALUES ($1::uuid, $2::uuid, $1, $3, $4, $5)
    `, [
      teamId,
      tournamentId,
      `Team ${index + 1}`,
      `team ${index + 1}`,
      index + 1
    ]);
    await database.query(`
      INSERT INTO engine_pod_teams (
        tournament_id, pod_id, team_id, initial_seed, assigned_at
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
    `, [tournamentId, podIds[podIndex], teamId, index % 2 + 1, timestamp]);
    await database.query(`
      INSERT INTO engine_players (
        id, tournament_id, public_key, display_name, created_at
      ) VALUES
        ($1::uuid, $3::uuid, $1, $4, $6),
        ($2::uuid, $3::uuid, $2, $5, $6)
    `, [
      playerIds[index],
      historicalPlayerIds[index],
      tournamentId,
      `Player ${index + 1}`,
      `Historical Player ${index + 1}`,
      earlier
    ]);
    await database.query(`
      INSERT INTO engine_roster_memberships (
        id, tournament_id, public_key, team_id, player_id, roster_slot,
        opened_at, closed_at, opened_by, closed_by, replacement_reason
      ) VALUES
        ($1::uuid, $5::uuid, $1, $6::uuid, $3::uuid, 1,
         $8, NULL, $7, NULL, NULL),
        ($2::uuid, $5::uuid, $2, $6::uuid, $4::uuid, 1,
         $9, $8, $7, $7, 'Sanitized prior participant')
    `, [
      membershipIds[index],
      historicalMembershipIds[index],
      playerIds[index],
      historicalPlayerIds[index],
      tournamentId,
      teamId,
      adminId,
      timestamp,
      earlier
    ]);
  }
  for (const [index, matchId] of matchIds.entries()) {
    await database.query(`
      INSERT INTO match_identities (match_id, tournament_id, created_at)
      VALUES ($1, $2, $3)
    `, [matchId, tournamentId, timestamp]);
    await database.query(`
      INSERT INTO engine_matches (
        id, tournament_id, public_key, stage, pod_id, sequence,
        status, score_availability, row_version, created_at, updated_at,
        metadata
      ) VALUES (
        $1::uuid, $2::uuid, $1, 'pod_play', $3::uuid, $4,
        'scheduled', 'not_started', 1, $5, $5,
        '{"sequenceInPod":1,"roundNumber":1,"gameNumberForPair":1}'::jsonb
      )
    `, [matchId, tournamentId, podIds[index], index + 1, timestamp]);
    for (const slot of [0, 1] as const) {
      await database.query(`
        INSERT INTO engine_match_slots (
          tournament_id, match_id, slot_number, source_type, team_id
        ) VALUES ($1::uuid, $2::uuid, $3, 'team', $4::uuid)
      `, [tournamentId, matchId, slot + 1, teamIds[index * 2 + slot]]);
    }
  }
  await database.query(`
    UPDATE engine_tournament_configurations SET locked_at = $2
    WHERE tournament_id = $1::uuid
  `, [tournamentId, timestamp]);
  await database.query(`
    UPDATE engine_tournaments
    SET lifecycle = 'setup_published', visibility = 'public', row_version = 2,
        setup_published_at = $2, updated_at = $2
    WHERE id = $1::uuid
  `, [tournamentId, timestamp]);
  return {
    tournamentId,
    adminId,
    podIds,
    teamIds,
    playerIds,
    historicalPlayerIds,
    membershipIds,
    historicalMembershipIds,
    matchIds
  };
}

function generatedWorkbook(fixture: Fixture): StoreGeneratedWorkbookInput {
  const artifact = Buffer.from("PK\u0003\u0004sanitized-canonical-workbook", "utf8");
  const sheets: GeneratedWorkbookSheetInput[] = [
    {
      sheetId: randomUUID(),
      sheetOrdinal: 1,
      sheetKind: "control",
      sheetName: "Tournament Control",
      baselineFingerprint: null
    },
    {
      sheetId: randomUUID(),
      sheetOrdinal: 2,
      sheetKind: "blank",
      sheetName: "Blank Scorecard",
      baselineFingerprint: digest("blank")
    },
    ...fixture.matchIds.map((matchId, index) => ({
      sheetId: randomUUID(),
      sheetOrdinal: index + 3,
      sheetKind: "game" as const,
      sheetName: `Pod ${index + 1} Game 1`,
      matchId,
      generatedMatchRowVersion: 1,
      participantTeamIds: [
        fixture.teamIds[index * 2],
        fixture.teamIds[index * 2 + 1]
      ] as const,
      participantDigest: digest(`participants-${index}`),
      baselineFingerprint: digest(`baseline-${index + 1}`)
    }))
  ];
  return {
    workbookId: randomUUID(),
    tournamentId: fixture.tournamentId,
    generationRevision: 1,
    workbookSchemaVersion: 1,
    generationKind: "setup",
    sourceTournamentRowVersion: 2,
    sourceDigest: digest("generation-source"),
    artifact,
    artifactDigest: createHash("sha256").update(artifact).digest("hex"),
    filename: "sanitized-phase-3.xlsx",
    generatedByAdminId: fixture.adminId,
    generatedAt: new Date().toISOString(),
    sheets,
    audit: { eventId: randomUUID() }
  };
}

function candidateFor(
  fixture: Fixture,
  matchIndex: number,
  input: {
    sourceRevisionNumber: number;
    fingerprint: string;
    reason: WorkbookRevisionCandidateInput["reason"];
    previousAppliedCandidateId?: string;
    useHistoricalPlayer?: boolean;
    proposedStatus?: WorkbookRevisionCandidateInput["proposedStatus"];
    proposedScoreAvailability?: WorkbookRevisionCandidateInput[
      "proposedScoreAvailability"
    ];
  }
): WorkbookRevisionCandidateInput {
  const teamIndexes = [matchIndex * 2, matchIndex * 2 + 1] as const;
  const teams: WorkbookRevisionCandidateTeamInput[] = teamIndexes.map(
    (teamIndex, sideIndex) => ({
      sideNumber: (sideIndex + 1) as 1 | 2,
      teamId: fixture.teamIds[teamIndex],
      displayName: `Team ${teamIndex + 1}`,
      players: [{
        playerId: input.useHistoricalPlayer
          ? fixture.historicalPlayerIds[teamIndex]
          : fixture.playerIds[teamIndex],
        rosterMembershipId: input.useHistoricalPlayer
          ? fixture.historicalMembershipIds[teamIndex]
          : fixture.membershipIds[teamIndex],
        rosterSlot: 1,
        displayName: input.useHistoricalPlayer
          ? `Historical Player ${teamIndex + 1}`
          : `Player ${teamIndex + 1}`
      }]
    })
  );
  const envelope = {
    schemaVersion: 1,
    rows: [{ row: 1, values: { result: input.reason } }]
  };
  return {
    candidateId: randomUUID(),
    matchId: fixture.matchIds[matchIndex],
    ...(input.previousAppliedCandidateId === undefined
      ? {}
      : { previousAppliedCandidateId: input.previousAppliedCandidateId }),
    sourceRevisionNumber: input.sourceRevisionNumber,
    fingerprint: input.fingerprint,
    proposedStatus: input.proposedStatus ?? (
      input.reason === "initial" ? "in_progress" : "final"
    ),
    proposedScoreAvailability: input.proposedScoreAvailability ?? (
      input.reason === "initial" ? "partial" : "complete"
    ),
    reason: input.reason,
    requiresConfirmation: input.reason === "correction",
    expectedMatchRowVersion: 1,
    expectedSourceStateVersion: input.sourceRevisionNumber - 1,
    envelopeSchemaVersion: 1,
    envelope,
    envelopeDigest: digestWorkbookValue(envelope),
    participantDigest: digestWorkbookParticipants(teams),
    teams
  };
}

function proposedObservation(
  sheet: GeneratedWorkbookSheetInput,
  matchId: string,
  candidate: WorkbookRevisionCandidateInput,
  baseSourceStateVersion = 0
): WorkbookImportObservationInput {
  if (sheet.sheetKind !== "game") {
    throw new Error("Proposal fixture requires a game sheet.");
  }
  const sourceEnvelope = { schemaVersion: 1, rows: [{ row: 1, values: {} }] };
  return {
    observationId: randomUUID(),
    observationKind: "present",
    sheetOrdinal: sheet.sheetOrdinal,
    workbookSheetId: sheet.sheetId,
    matchId,
    assignmentSource: "stable_metadata",
    disposition: "proposed",
    fingerprint: candidate.fingerprint,
    baseMatchRowVersion: 1,
    baseSourceStateVersion,
    sourceEnvelopeSchemaVersion: 1,
    sourceEnvelope,
    sourceEnvelopeDigest: digestWorkbookValue(sourceEnvelope),
    validationIssues: [],
    candidate
  };
}

function unchangedObservation(
  sheet: GeneratedWorkbookSheetInput,
  matchId: string,
  fingerprint: string,
  baseSourceStateVersion: number
): WorkbookImportObservationInput {
  if (sheet.sheetKind !== "game") {
    throw new Error("Unchanged fixture requires a game sheet.");
  }
  const sourceEnvelope = { schemaVersion: 1, rows: [{ row: 1, values: {} }] };
  return {
    observationId: randomUUID(),
    observationKind: "present",
    sheetOrdinal: sheet.sheetOrdinal,
    workbookSheetId: sheet.sheetId,
    matchId,
    assignmentSource: "stable_metadata",
    disposition: "unchanged",
    fingerprint,
    baseMatchRowVersion: 1,
    baseSourceStateVersion,
    sourceEnvelopeSchemaVersion: 1,
    sourceEnvelope,
    sourceEnvelopeDigest: digestWorkbookValue(sourceEnvelope),
    validationIssues: []
  };
}

function missingObservation(
  sheet: GeneratedWorkbookSheetInput,
  matchId: string
): WorkbookImportObservationInput {
  return {
    observationId: randomUUID(),
    observationKind: "missing",
    workbookSheetId: sheet.sheetId,
    matchId,
    assignmentSource: "none",
    disposition: "missing",
    baseMatchRowVersion: 1,
    baseSourceStateVersion: 0,
    validationIssues: []
  };
}

function previewInput(
  fixture: Fixture,
  generation: StoreGeneratedWorkbookInput,
  observations: readonly WorkbookImportObservationInput[]
): CreateWorkbookImportPreviewInput {
  const previewedAt = new Date();
  return {
    batchId: randomUUID(),
    tournamentId: fixture.tournamentId,
    workbookId: generation.workbookId,
    workbookSchemaVersion: 1,
    sourceWorkbookDigest: generation.artifactDigest,
    sourceSizeBytes: generation.artifact.byteLength,
    baseTournamentRowVersion: 2,
    previewDigest: digestWorkbookValue({
      observations: observations.map((item) => ({
        id: item.observationId,
        disposition: item.disposition
      }))
    }),
    status: "preview_ready",
    receivedByAdminId: fixture.adminId,
    receivedAt: new Date(previewedAt.getTime() - 1_000).toISOString(),
    previewedAt: previewedAt.toISOString(),
    observations,
    audit: { eventId: randomUUID() }
  };
}

async function count(database: PostgresDatabase, table: string): Promise<number> {
  if (!/^engine_[a-z_]+$/.test(table)) {
    throw new Error("Unexpected fixture table name.");
  }
  const result = await database.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table}`
  );
  return Number(result.rows[0]?.count ?? 0);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
