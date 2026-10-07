import { randomUUID } from "node:crypto";

import { Workbook, Worksheet } from "exceljs";

import { AdminTournamentProgressionService } from
  "../../admin/tournament-progression/admin-tournament-progression.service";
import { AdminTournamentSetupService } from
  "../../admin/tournament-setup/admin-tournament-setup.service";
import { AdminTournamentSetupValidator } from
  "../../admin/tournament-setup/admin-tournament-setup.validator";
import { AdminTournamentWorkbookService } from
  "../../admin/tournament-workbooks/admin-tournament-workbook.service";
import { AdministratorSecurityAuditService } from
  "../../admin/security/administrator-security-audit.service";
import { AdministratorPrincipal } from
  "../../admin/security/administrator-security.types";
import { loadDatabaseConfig } from "../../config/database.config";
import { PostgresDatabase } from "../../database";
import { PostgresPublicProjectionReadRepository } from
  "../../public-api/v2/postgres-public-projection-read.repository";
import { PublicV2Service } from "../../public-api/v2/public-v2.service";
import {
  createCanonicalProjectionActivationListener,
  RealtimeEventBroadcaster,
  RealtimeUpdatePublisher
} from "../../realtime";
import { isStableUuid } from "../domain";
import { createDigest } from "../legacy/legacy-determinism";
import {
  PostgresCanonicalStatisticRepository,
  PostgresMatchRevisionRepository,
  PostgresMatchWriterRepository,
  PostgresProjectionRepository,
  PostgresTournamentProgressionRepository,
  PostgresTournamentSetupRepository,
  TournamentEngineTransactionManager
} from "../persistence";
import { createSmallTournamentConfiguration } from "../setup";
import { PostgresWorkbookReconciliationRepository } from "../workbook";

const REHEARSAL_TOURNAMENT_NAME =
  "Phase 7 Restored Lifecycle Rehearsal";
const REHEARSAL_TOURNAMENT_YEAR = 2099;
const REQUIRED_MIGRATIONS = Object.freeze(
  Array.from({ length: 13 }, (_, index) => index + 1)
);
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SHA256 = /^[a-f0-9]{64}$/u;
const RESTORE_SCOPED_DATABASE =
  /(?:^|[_-])(?:restore|restored|rehearsal|qualification)(?:[_-]|$)/u;
const PROTECTED_DATABASE_NAMES = new Set([
  "postgres",
  "template0",
  "template1",
  "ruski_report"
]);
const SAFE_PROGRESSION_DETAIL_CODES = new Map<string, string>([
  [
    "Tournament changed before progression could activate.",
    "progression_version_changed_before_activation"
  ],
  [
    "Tournament changed after progression was prepared.",
    "progression_version_changed_after_preview"
  ],
  [
    "Workbook generation revision is stale; regenerate from current source.",
    "workbook_generation_revision_stale"
  ],
  [
    "Workbook operations require published tournament setup.",
    "workbook_requires_published_setup"
  ],
  [
    "Tournament changed after workbook source was read.",
    "tournament_changed_after_workbook_source"
  ],
  [
    "This tournament already has a published bracket.",
    "bracket_already_published"
  ],
  [
    "Effective seeds changed after bracket preview was prepared.",
    "effective_seeds_changed_after_preview"
  ],
  [
    "The seed override changed after bracket preview was prepared.",
    "seed_override_changed_after_preview"
  ],
  [
    "Canonical projection source changed while it was being captured.",
    "canonical_projection_source_changed"
  ],
  [
    "Active match revision pointers are not projection-coherent.",
    "active_match_revision_pointer_incoherent"
  ],
  [
    "Active tournament statistics do not reference an aggregate run.",
    "active_tournament_statistics_incoherent"
  ],
  [
    "Bracket resolution winner disagrees with the active match revision.",
    "bracket_resolution_winner_incoherent"
  ],
  [
    "The same canonical source is already the active public projection.",
    "canonical_projection_source_already_active"
  ],
  [
    "Projection could not be activated from its current state.",
    "projection_activation_state_changed"
  ],
  [
    "Tournament changed after the projection was prepared.",
    "tournament_changed_after_projection_prepared"
  ]
]);

export interface PostgresFullLifecycleRehearsalInput {
  databaseUrl: string;
  expectedDatabaseName: string;
  administratorId: string;
  legacyTournamentId: string;
  candidateCommitSha: string;
}

export interface PostgresFullLifecycleRehearsalSummary {
  schemaVersion: 1;
  scope: "restored-database-full-lifecycle";
  status: "passed";
  candidateCommitSha: string;
  database: {
    expectedNameMatched: true;
    postgresMajorVersion: number;
    migrations: number;
    backfillCheckpoint: "completed_with_no_op_retry";
    protectedLegacyRowsPreserved: true;
  };
  gates: readonly {
    id: string;
    status: "passed";
    evidenceCode: string;
  }[];
  lifecycle: {
    projectionVersions: readonly number[];
    workbookImports: {
      applied: number;
      noOp: number;
      missingNonDestructive: number;
      corrections: number;
    };
    matchRevisionCount: number;
    projectionCount: number;
    realtime: {
      tournamentEvents: number;
      matchEvents: number;
      allVersionPinned: true;
    };
    setupWorkbookDigest: string;
    playoffWorkbookDigest: string;
    evidenceDigest: string;
  };
}

export class RehearsalFailure extends Error {
  constructor(readonly evidenceCode: string) {
    super(evidenceCode);
    this.name = "RehearsalFailure";
  }
}

export async function runPostgresFullLifecycleRehearsal(
  input: PostgresFullLifecycleRehearsalInput
): Promise<PostgresFullLifecycleRehearsalSummary> {
  validateInput(input);
  const configuration = loadDatabaseConfig({
    ...process.env,
    DATABASE_URL: input.databaseUrl
  });
  const database = new PostgresDatabase(configuration);

  try {
    const preflight = await preflightDatabase(database, input);
    const protectedRowsBefore = await protectedLegacyRowDigest(
      database,
      input.legacyTournamentId
    );
    requireCondition(
      protectedRowsBefore === preflight.protectedLegacyDigest,
      "protected_legacy_checkpoint_mismatch"
    );
    const runtime = createRuntime(database, input.administratorId);
    const gates: Array<{
      id: string;
      status: "passed";
      evidenceCode: string;
    }> = [];
    const pass = (id: string, evidenceCode: string) => {
      gates.push({ id, status: "passed", evidenceCode });
    };

    const draft = await guarded("setup_create_failed", () =>
      runtime.setup.create({
        name: REHEARSAL_TOURNAMENT_NAME,
        year: REHEARSAL_TOURNAMENT_YEAR,
        configuration: {
          kind: "advanced",
          value: createSmallTournamentConfiguration()
        }
      }, runtime.principal)
    );
    const tournamentId = draft.tournament.id;
    const publicTournamentId = draft.tournament.publicKey;
    const prepared = await guarded("setup_replace_failed", () =>
      runtime.setup.replaceDraft(tournamentId, {
        expectedRowVersion: draft.tournament.rowVersion,
        pods: draft.pods.map((pod) => ({ id: pod.id, name: pod.name })),
        teams: Array.from({ length: 4 }, (_, teamIndex) => ({
          name: `Qualification Team ${teamIndex + 1}`,
          podId: draft.pods[Math.floor(teamIndex / 2)]?.id,
          initialSeed: teamIndex % 2 + 1,
          players: [1, 2].map((player) => ({
            displayName: `Qualification Player ${teamIndex + 1}-${player}`
          }))
        }))
      }, runtime.principal)
    );
    const setupPreview = await guarded("setup_preview_failed", () =>
      runtime.setup.preview(tournamentId, {
        expectedRowVersion: prepared.tournament.rowVersion
      })
    );
    requireCondition(
      setupPreview.publishable && setupPreview.previewDigest !== null &&
        setupPreview.matchCount === 2,
      "setup_preview_invalid"
    );
    const matchIds = setupPreview.matches.map((match) => match.id);
    requireCondition(matchIds.length === 2, "setup_schedule_invalid");
    await guarded("setup_publish_failed", () => runtime.setup.publish(
      tournamentId,
      {
        expectedRowVersion: setupPreview.rowVersion,
        previewDigest: setupPreview.previewDigest,
        visibility: "public"
      },
      runtime.principal
    ));

    const projections = new ProjectionVerifier(
      runtime.publicReads,
      runtime.events,
      publicTournamentId
    );
    await projections.expectAdvance("setup_published", 2);
    pass("setup-publication", "published_two_match_setup");

    const publishedSetup = await runtime.setup.get(tournamentId);
    const setupGeneration = await guarded("setup_workbook_generation_failed", () =>
      runtime.workbooks.generate(tournamentId, {
        expectedTournamentRowVersion: publishedSetup.tournament.rowVersion
      }, runtime.principal)
    );
    requireCondition(
      SHA256.test(setupGeneration.artifactSha256),
      "setup_workbook_digest_invalid"
    );
    const setupArtifact = await guarded("setup_workbook_read_failed", () =>
      runtime.workbooks.download(tournamentId, setupGeneration.id)
    );
    pass("workbook-generation", "setup_workbook_persisted");

    const beginning = await applyWorkbook(
      runtime,
      tournamentId,
      setupArtifact.artifact,
      "beginning"
    );
    requireCondition(
      beginning.result.status === "no_op" &&
        beginning.result.acceptedCount === 0,
      "beginning_import_not_no_op"
    );
    await projections.expectNoChange("setup_published");
    pass("workbook-beginning", "unchanged_workbook_no_op");

    const middleBuffer = await mutateWorkbook(
      setupArtifact.artifact,
      (workbook) => {
        const live = findMatchWorksheet(workbook, matchIds[0]);
        live.getCell("B2").value = "LIVE GAME";
        live.getCell("E10").value = "X";
        const missing = findMatchWorksheet(workbook, matchIds[1]);
        workbook.removeWorksheet(missing.id);
      }
    );
    const middle = await applyWorkbook(
      runtime,
      tournamentId,
      middleBuffer,
      "middle"
    );
    requireCondition(
      middle.result.status === "applied" &&
        middle.result.acceptedCount === 1 &&
        middle.result.missingNonDestructiveCount === 1,
      "middle_import_invalid"
    );
    await projections.expectAdvance("pod_play", 1);
    pass("workbook-middle-missing", "live_and_missing_non_destructive");

    const finalBuffer = await mutateWorkbook(
      setupArtifact.artifact,
      (workbook) => {
        const first = findMatchWorksheet(workbook, matchIds[0]);
        first.getCell("B2").value = "FINAL";
        first.getCell("E10").value = "X";
        const second = findMatchWorksheet(workbook, matchIds[1]);
        second.getCell("B2").value = "FINAL";
        second.getCell("E10").value = "X";
      }
    );
    const end = await applyWorkbook(
      runtime,
      tournamentId,
      finalBuffer,
      "pod-end"
    );
    requireCondition(
      end.result.status === "applied" && end.result.acceptedCount === 2,
      "pod_end_import_invalid"
    );
    const preCorrectionVersion = await projections.expectAdvance("pod_play", 2);
    pass("workbook-pod-end", "all_pod_matches_final");

    const revisionCountBeforeCorrection = await matchRevisionCount(
      database,
      tournamentId,
      matchIds[0]
    );
    const correctedBuffer = await mutateWorkbook(finalBuffer, (workbook) => {
      findMatchWorksheet(workbook, matchIds[0]).getCell("E12").value = "X";
    });
    const correction = await applyWorkbook(
      runtime,
      tournamentId,
      correctedBuffer,
      "correction",
      "Confirmed restored-copy score correction"
    );
    requireCondition(
      correction.result.status === "applied" &&
        correction.result.acceptedCount === 1,
      "correction_import_invalid"
    );
    const revisionCountAfterCorrection = await matchRevisionCount(
      database,
      tournamentId,
      matchIds[0]
    );
    requireCondition(
      revisionCountAfterCorrection === revisionCountBeforeCorrection + 1,
      "correction_revision_not_preserved"
    );
    await projections.expectAdvance("pod_play", 1);
    const pinned = await guarded("pinned_projection_read_failed", () =>
      runtime.publicReads.getTournament(publicTournamentId, preCorrectionVersion)
    );
    requireCondition(
      pinned.projection.version === preCorrectionVersion,
      "pinned_projection_changed"
    );
    pass("workbook-correction", "immutable_correction_revision_activated");

    const identical = await applyWorkbook(
      runtime,
      tournamentId,
      correctedBuffer,
      "identical-reimport"
    );
    requireCondition(
      identical.result.status === "no_op" &&
        identical.result.acceptedCount === 0,
      "identical_reimport_not_no_op"
    );
    await projections.expectNoChange("pod_play");
    pass("workbook-identical-reimport", "identical_reimport_no_op");

    for (let podIndex = 0; podIndex < 2; podIndex += 1) {
      const progression = await guarded("progression_read_failed", () =>
        runtime.progression.get(tournamentId)
      );
      const pod = [...progression.pods]
        .sort((left, right) => left.sequence - right.sequence)[podIndex];
      requireCondition(
        pod !== undefined && pod.activeCalculationId !== undefined &&
          pod.calculationStatus === "finalizable",
        "pod_not_finalizable"
      );
      const preview = await guarded("pod_finalization_preview_failed", () =>
        runtime.progression.previewPodFinalization(tournamentId, pod.podId, {
          expectedTournamentRowVersion: progression.rowVersion,
          calculationId: pod.activeCalculationId,
          reason: "Restored lifecycle qualification"
        })
      );
      await guarded("pod_finalization_failed", () =>
        runtime.progression.finalizePod(tournamentId, pod.podId, {
          expectedTournamentRowVersion: progression.rowVersion,
          calculationId: pod.activeCalculationId,
          reason: "Restored lifecycle qualification",
          confirmationDigest: preview.confirmationDigest
        }, runtime.principal)
      );
      await projections.expectAdvance(
        podIndex === 0 ? "pod_play" : "seeding_review",
        0
      );
    }
    pass("standings-finalization", "all_pods_finalized");

    let seeded = await guarded("seed_progression_read_failed", () =>
      runtime.progression.get(tournamentId)
    );
    let globalTieResolutions = 0;
    while (seeded.activeGlobalSeedReview?.status === "unresolved_tie") {
      const review = seeded.activeGlobalSeedReview;
      const tie = review.tieGroups.find((candidate) => !candidate.resolved);
      requireCondition(
        tie !== undefined && globalTieResolutions < 8,
        "global_seed_tie_resolution_unbounded"
      );
      const reason = "Restored lifecycle qualification seed tie";
      const preview = await guarded("global_seed_tie_preview_failed", () =>
        runtime.progression.previewGlobalSeedTie(tournamentId, {
          expectedTournamentRowVersion: seeded.rowVersion,
          activeReviewVersionId: review.reviewVersionId,
          seedCalculationId: review.seedCalculationId,
          tieGroupId: tie.tieGroupId,
          orderedTeamIds: [...tie.teamIds].reverse(),
          reason
        })
      );
      await guarded("global_seed_tie_resolution_failed", () =>
        runtime.progression.resolveGlobalSeedTie(tournamentId, {
          expectedTournamentRowVersion: seeded.rowVersion,
          activeReviewVersionId: review.reviewVersionId,
          seedCalculationId: review.seedCalculationId,
          tieGroupId: tie.tieGroupId,
          orderedTeamIds: [...tie.teamIds].reverse(),
          reason,
          confirmationDigest: preview.confirmationDigest
        }, runtime.principal)
      );
      await projections.expectAdvance("seeding_review", 0);
      globalTieResolutions += 1;
      seeded = await guarded("seed_progression_read_failed", () =>
        runtime.progression.get(tournamentId)
      );
    }
    requireCondition(
      seeded.lifecycle === "seeding_review" &&
        seeded.activeSeedCalculationId !== undefined &&
        seeded.activeGlobalSeedReview?.status === "complete" &&
        seeded.effectiveSeeds.length === 2,
      "global_seeding_incomplete"
    );
    pass(
      "global-seeding-review",
      globalTieResolutions === 0
        ? "global_seeding_complete"
        : "global_seed_ties_resolved"
    );
    const reversedSeeds = [...seeded.effectiveSeeds]
      .sort((left, right) => right.effectiveSeed - left.effectiveSeed)
      .map((seed) => seed.teamId);
    const overridePreview = await guarded("seed_override_preview_failed", () =>
      runtime.progression.previewSeedOverride(tournamentId, {
        expectedTournamentRowVersion: seeded.rowVersion,
        calculationId: seeded.activeSeedCalculationId,
        orderedTeamIds: reversedSeeds,
        reason: "Restored lifecycle qualification seed permutation"
      })
    );
    await guarded("seed_override_failed", () =>
      runtime.progression.overrideSeeds(tournamentId, {
        expectedTournamentRowVersion: seeded.rowVersion,
        calculationId: seeded.activeSeedCalculationId,
        orderedTeamIds: reversedSeeds,
        reason: "Restored lifecycle qualification seed permutation",
        confirmationDigest: overridePreview.confirmationDigest
      }, runtime.principal)
    );
    await projections.expectAdvance("seeding_review", 0);
    pass("seeding-override", "audited_seed_permutation_activated");

    const bracketProgression = await guarded("bracket_progression_read_failed", () =>
      runtime.progression.get(tournamentId)
    );
    const bracketPreview = await guarded("bracket_preview_failed", () =>
      runtime.progression.previewBracket(tournamentId, {
        expectedTournamentRowVersion: bracketProgression.rowVersion
      })
    );
    const bracket = await guarded("bracket_publication_failed", () =>
      runtime.progression.publishBracket(tournamentId, {
        expectedTournamentRowVersion: bracketProgression.rowVersion,
        confirmationDigest: bracketPreview.confirmationDigest
      }, runtime.principal)
    );
    requireCondition(
      bracket.playableMatchIds.length === 1 &&
        SHA256.test(bracket.workbook.sha256),
      "published_bracket_invalid"
    );
    await projections.expectAdvance("playoffs", 1);
    pass("bracket-publication", "cumulative_playoff_workbook_published");

    const playoffArtifact = await guarded("playoff_workbook_read_failed", () =>
      runtime.workbooks.download(tournamentId, bracket.workbook.id)
    );
    const championshipBuffer = await mutateWorkbook(
      playoffArtifact.artifact,
      (workbook) => {
        const championship = findMatchWorksheet(
          workbook,
          bracket.playableMatchIds[0]
        );
        championship.getCell("B2").value = "FINAL";
        championship.getCell("E10").value = "X";
      }
    );
    const championship = await applyWorkbook(
      runtime,
      tournamentId,
      championshipBuffer,
      "championship"
    );
    requireCondition(
      championship.result.status === "applied" &&
        championship.result.acceptedCount === 1,
      "championship_import_invalid"
    );
    await projections.expectAdvance("completed", 1);
    const completed = await guarded("completed_projection_read_failed", () =>
      runtime.publicReads.getTournament(publicTournamentId)
    );
    const championshipNode = completed.tournament.bracket?.rounds
      .flatMap((round) => round.matches)
      .find((match) => match.matchId === bracket.playableMatchIds[0]);
    requireCondition(
      completed.tournament.lifecycle === "completed" &&
        championshipNode?.status === "completed" &&
        championshipNode.winner !== null,
      "champion_projection_invalid"
    );
    const [activeDiscovery, historicalDiscovery] = await Promise.all([
      runtime.publicReads.listActiveTournaments(),
      runtime.publicReads.listHistoricalTournaments()
    ]);
    requireCondition(
      !activeDiscovery.tournaments.some(
        (item) => item.tournament.id === publicTournamentId
      ) && historicalDiscovery.tournaments.some(
        (item) => item.tournament.id === publicTournamentId
      ),
      "completed_discovery_invalid"
    );
    pass("champion-projection", "completed_champion_in_history");

    const protectedRowsAfter = await protectedLegacyRowDigest(
      database,
      input.legacyTournamentId
    );
    requireCondition(
      protectedRowsAfter === protectedRowsBefore,
      "protected_legacy_rows_changed"
    );
    pass("legacy-preservation", "protected_legacy_digest_unchanged");

    const counts = await lifecycleCounts(database, tournamentId);
    const eventEvidence = eventCounts(runtime.events);
    requireCondition(eventEvidence.allVersionPinned, "realtime_event_unpinned");
    const importEvidence = {
      applied: [middle, end, correction, championship]
        .filter((item) => item.result.status === "applied").length,
      noOp: [beginning, identical]
        .filter((item) => item.result.status === "no_op").length,
      missingNonDestructive:
        middle.result.missingNonDestructiveCount,
      corrections: correction.preview.observations.filter(
        (observation) => observation.correction
      ).length
    };
    const evidenceCore = {
      projectionVersions: projections.versions,
      workbookImports: importEvidence,
      matchRevisionCount: counts.matchRevisionCount,
      projectionCount: counts.projectionCount,
      realtime: eventEvidence,
      setupWorkbookDigest: setupGeneration.artifactSha256,
      playoffWorkbookDigest: bracket.workbook.sha256
    };

    return {
      schemaVersion: 1,
      scope: "restored-database-full-lifecycle",
      status: "passed",
      candidateCommitSha: input.candidateCommitSha,
      database: {
        expectedNameMatched: true,
        postgresMajorVersion: preflight.postgresMajorVersion,
        migrations: REQUIRED_MIGRATIONS.length,
        backfillCheckpoint: "completed_with_no_op_retry",
        protectedLegacyRowsPreserved: true
      },
      gates,
      lifecycle: {
        ...evidenceCore,
        realtime: {
          tournamentEvents: eventEvidence.tournamentEvents,
          matchEvents: eventEvidence.matchEvents,
          allVersionPinned: true
        },
        evidenceDigest: sha256(evidenceCore)
      }
    };
  } finally {
    await database.onApplicationShutdown();
  }
}

function createRuntime(database: PostgresDatabase, administratorId: string) {
  const events: unknown[] = [];
  const broadcaster: RealtimeEventBroadcaster = {
    broadcast: (event) => events.push(event)
  };
  const realtime = new RealtimeUpdatePublisher(broadcaster);
  const listener = createCanonicalProjectionActivationListener(realtime);
  const transactions = new TournamentEngineTransactionManager(database);
  const projections = new PostgresProjectionRepository(database, transactions);
  const progressionRepository = new PostgresTournamentProgressionRepository(
    database,
    transactions,
    projections,
    listener
  );
  const setupRepository = new PostgresTournamentSetupRepository(
    database,
    transactions,
    projections,
    listener
  );
  const writers = new PostgresMatchWriterRepository(database, transactions);
  const revisions = new PostgresMatchRevisionRepository(database, transactions);
  const statistics = new PostgresCanonicalStatisticRepository(database);
  const workbookRepository = new PostgresWorkbookReconciliationRepository(
    database,
    transactions,
    writers,
    revisions,
    statistics,
    progressionRepository,
    projections,
    listener
  );
  const securityAudit = {
    recordEvent: async () => undefined
  } as unknown as AdministratorSecurityAuditService;
  const principal: AdministratorPrincipal = {
    administratorId,
    loginName: "qualification-operator",
    displayName: "Qualification Operator",
    sessionId: randomUUID(),
    authenticatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString()
  };
  const publicRepository = new PostgresPublicProjectionReadRepository(database);

  return {
    events,
    principal,
    setup: new AdminTournamentSetupService(
      setupRepository,
      new AdminTournamentSetupValidator(),
      securityAudit
    ),
    workbooks: new AdminTournamentWorkbookService(
      workbookRepository,
      progressionRepository
    ),
    progression: new AdminTournamentProgressionService(
      progressionRepository,
      workbookRepository,
      transactions,
      projections,
      realtime
    ),
    publicReads: new PublicV2Service(publicRepository)
  };
}

class ProjectionVerifier {
  readonly versions: number[] = [];
  private currentVersion = 0;
  private eventCursor = 0;

  constructor(
    private readonly publicReads: PublicV2Service,
    private readonly events: readonly unknown[],
    private readonly tournamentId: string
  ) {}

  async expectAdvance(
    lifecycle: string,
    minimumMatchEvents: number
  ): Promise<number> {
    const envelope = await guarded("projection_read_failed", () =>
      this.publicReads.getTournament(this.tournamentId)
    );
    requireCondition(
      envelope.tournament.lifecycle === lifecycle &&
        envelope.projection.version > this.currentVersion,
      "projection_did_not_advance"
    );
    const emitted = this.events.slice(this.eventCursor);
    const version = envelope.projection.version;
    requireCondition(
      emitted.filter((event) => eventType(event) === "tournament.updated")
        .some((event) => eventVersion(event) === version) &&
        emitted.filter((event) => eventType(event) === "match.updated" &&
          eventVersion(event) === version).length >= minimumMatchEvents &&
        emitted.every((event) => eventVersion(event) === version),
      "projection_realtime_mismatch"
    );
    this.currentVersion = version;
    this.eventCursor = this.events.length;
    this.versions.push(version);
    return version;
  }

  async expectNoChange(lifecycle: string): Promise<void> {
    const envelope = await guarded("projection_read_failed", () =>
      this.publicReads.getTournament(this.tournamentId)
    );
    requireCondition(
      envelope.tournament.lifecycle === lifecycle &&
        envelope.projection.version === this.currentVersion &&
        this.events.length === this.eventCursor,
      "no_op_projection_changed"
    );
  }
}

async function applyWorkbook(
  runtime: ReturnType<typeof createRuntime>,
  tournamentId: string,
  buffer: Buffer,
  label: string,
  correctionReason?: string
) {
  const preview = await guarded(`${label}_preview_failed`, () =>
    runtime.workbooks.preview(tournamentId, {
      buffer,
      originalname: `${label}.xlsx`,
      mimetype: XLSX_MIME,
      size: buffer.byteLength
    }, runtime.principal)
  );
  requireCondition(
    preview.previewDigest !== null &&
      preview.status !== "preview_rejected" &&
      preview.status !== "assignment_required" &&
      preview.status !== "expired" &&
      preview.counts.invalid === 0 && preview.counts.unresolved === 0,
    `${label}_preview_invalid`
  );
  const proposed = preview.observations.filter(
    (observation) => observation.classification === "proposed"
  );
  const correctionReasons = Object.fromEntries(
    proposed.filter((observation) => observation.correction).map(
      (observation) => [
        observation.id,
        correctionReason ?? "Confirmed restored-copy correction"
      ]
    )
  );
  const result = await guarded(`${label}_apply_failed`, () =>
    runtime.workbooks.apply(tournamentId, preview.id, {
      previewDigest: preview.previewDigest,
      acceptedObservationIds: proposed.map((observation) => observation.id),
      skippedObservationIds: [],
      correctionReasons,
      cascadeConfirmationDigests: {}
    }, runtime.principal)
  );
  return { preview, result };
}

async function mutateWorkbook(
  buffer: Buffer,
  mutation: (workbook: Workbook) => void
): Promise<Buffer> {
  const workbook = new Workbook();
  const contents = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  await workbook.xlsx.load(contents);
  mutation(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function findMatchWorksheet(workbook: Workbook, matchId: string): Worksheet {
  const worksheet = workbook.worksheets.find(
    (candidate) => candidate.getCell("W10").value === matchId
  );
  if (worksheet === undefined) {
    throw new RehearsalFailure("workbook_match_sheet_missing");
  }
  return worksheet;
}

async function preflightDatabase(
  database: PostgresDatabase,
  input: PostgresFullLifecycleRehearsalInput
) {
  const identity = await database.query<{
    database_name: string;
    server_version_num: string;
  }>(`
    SELECT current_database() AS database_name,
           current_setting('server_version_num') AS server_version_num
  `);
  const row = identity.rows[0];
  requireCondition(
    row?.database_name === input.expectedDatabaseName,
    "database_identity_mismatch"
  );
  const postgresMajorVersion = Math.floor(Number(row.server_version_num) / 10_000);
  requireCondition(
    Number.isSafeInteger(postgresMajorVersion) && postgresMajorVersion > 0,
    "postgres_version_invalid"
  );

  const migrations = await database.query<{ version: number }>(
    "SELECT version FROM schema_migrations ORDER BY version"
  );
  requireCondition(
    migrations.rows.length === REQUIRED_MIGRATIONS.length &&
      migrations.rows.every(
        (migration, index) => migration.version === REQUIRED_MIGRATIONS[index]
      ),
    "migration_set_mismatch"
  );
  const administrator = await database.query<{ present: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM admin_accounts
      WHERE id = $1::uuid AND status = 'active'
    ) AS present
  `, [input.administratorId]);
  requireCondition(
    administrator.rows[0]?.present === true,
    "administrator_not_active"
  );
  const checkpoint = await database.query<{
    status: string;
    outcome_status: string | null;
    protected_digest: string | null;
    linked: boolean;
  }>(`
    SELECT run.status,
           run.metadata ->> 'outcomeStatus' AS outcome_status,
           run.metadata ->> 'protectedLegacyDigest' AS protected_digest,
           EXISTS (
             SELECT 1 FROM engine_legacy_tournament_links link
             WHERE link.backfill_run_id = run.id
               AND link.legacy_tournament_id = run.legacy_tournament_id
           ) AS linked
    FROM engine_legacy_backfill_runs run
    WHERE run.legacy_tournament_id = $1
      AND run.status = 'completed'
    ORDER BY run.completed_at DESC, run.id DESC
    LIMIT 1
  `, [input.legacyTournamentId]);
  const backfill = checkpoint.rows[0];
  requireCondition(
    backfill?.status === "completed" &&
      backfill.outcome_status === "no_op" &&
      backfill.linked && SHA256.test(backfill.protected_digest ?? ""),
    "backfill_checkpoint_incomplete"
  );
  const duplicate = await database.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM engine_tournaments
    WHERE name = $1 AND year = $2
  `, [REHEARSAL_TOURNAMENT_NAME, REHEARSAL_TOURNAMENT_YEAR]);
  requireCondition(
    Number(duplicate.rows[0]?.count ?? 1) === 0,
    "rehearsal_already_present"
  );
  return {
    postgresMajorVersion,
    protectedLegacyDigest: backfill.protected_digest
  };
}

async function protectedLegacyRowDigest(
  database: PostgresDatabase,
  legacyTournamentId: string
): Promise<string> {
  const matchIds = (await database.query<{ match_id: string }>(`
    SELECT match_id FROM match_identities
    WHERE tournament_id = $1 ORDER BY match_id
  `, [legacyTournamentId])).rows.map((row) => row.match_id);
  const snapshotRows = await database.query<{
    table_name: string;
    row_key: string;
    row_version: string;
  }>(`
    SELECT 'tournaments' AS table_name, id AS row_key,
           xmin::text AS row_version
    FROM tournaments WHERE id = $1
    UNION ALL SELECT 'active_tournament_snapshots', tournament_id, xmin::text
    FROM active_tournament_snapshots WHERE tournament_id = $1
    UNION ALL SELECT 'tournament_snapshot_versions',
           tournament_id || ':' || version::text, xmin::text
    FROM tournament_snapshot_versions WHERE tournament_id = $1
    UNION ALL SELECT 'teams', snapshot_version::text || ':' || team_id,
           xmin::text FROM teams WHERE tournament_id = $1
    UNION ALL SELECT 'players', snapshot_version::text || ':' || player_id,
           xmin::text FROM players WHERE tournament_id = $1
    UNION ALL SELECT 'team_players', snapshot_version::text || ':' ||
           team_id || ':' || player_id, xmin::text
    FROM team_players WHERE tournament_id = $1
    UNION ALL SELECT 'pods', snapshot_version::text || ':' || pod_id,
           xmin::text FROM pods WHERE tournament_id = $1
    UNION ALL SELECT 'pod_teams', snapshot_version::text || ':' ||
           pod_id || ':' || team_id, xmin::text
    FROM pod_teams WHERE tournament_id = $1
    UNION ALL SELECT 'pod_matches', snapshot_version::text || ':' ||
           pod_id || ':' || match_id, xmin::text
    FROM pod_matches WHERE tournament_id = $1
    UNION ALL SELECT 'matches', snapshot_version::text || ':' || match_id,
           xmin::text FROM matches WHERE tournament_id = $1
    UNION ALL SELECT 'standings', snapshot_version::text || ':' || standing_id,
           xmin::text FROM standings WHERE tournament_id = $1
    UNION ALL SELECT 'scorebook_sources', source.id, source.xmin::text
    FROM scorebook_sources source WHERE source.id IN (
      SELECT version.source_id FROM tournament_snapshot_versions version
      WHERE version.tournament_id = $1
    )
    UNION ALL SELECT 'upload_reports', report.id, report.xmin::text
    FROM upload_reports report
    WHERE report.tournament_id = $1 OR report.source_id IN (
      SELECT version.source_id FROM tournament_snapshot_versions version
      WHERE version.tournament_id = $1
    )
    ORDER BY table_name, row_key
  `, [legacyTournamentId]);
  const identities = await database.query<{
    match_id: string;
    tournament_id: string;
    row_version: string;
  }>(`
    SELECT match_id, tournament_id, xmin::text AS row_version
    FROM match_identities WHERE match_id = ANY($1::text[])
    ORDER BY match_id
  `, [matchIds]);
  const comments = await database.query<{
    id: string;
    match_id: string;
    deleted_at: string | null;
    row_version: string;
  }>(`
    SELECT id, match_id, deleted_at::text, xmin::text AS row_version
    FROM comments WHERE match_id = ANY($1::text[]) ORDER BY id
  `, [matchIds]);
  const reports = await database.query<{
    id: string;
    comment_id: string | null;
    reported_comment_id: string | null;
    match_id: string;
    status: string;
    reviewed_at: string | null;
    resolved_at: string | null;
    resolution: string | null;
    moderator_id: string | null;
    row_version: string;
  }>(`
    SELECT id, comment_id, reported_comment_id, match_id, status,
           reviewed_at::text, resolved_at::text, resolution, moderator_id,
           xmin::text AS row_version
    FROM comment_reports WHERE match_id = ANY($1::text[]) ORDER BY id
  `, [matchIds]);
  const accountsAndBlocks = await database.query<{
    table_name: string;
    row_key: string;
    row_version: string;
  }>(`
    WITH relevant_accounts AS (
      SELECT author_user_id AS user_id
      FROM comments WHERE match_id = ANY($1::text[])
      UNION SELECT reporter_user_id FROM comment_reports
      WHERE match_id = ANY($1::text[])
    )
    SELECT 'user_accounts' AS table_name, account.id AS row_key,
           account.xmin::text AS row_version
    FROM user_accounts account
    WHERE account.id IN (SELECT user_id FROM relevant_accounts)
    UNION ALL SELECT 'local_account_credentials', credential.user_id,
           credential.xmin::text
    FROM local_account_credentials credential
    WHERE credential.user_id IN (SELECT user_id FROM relevant_accounts)
    UNION ALL SELECT 'external_identities',
           identity.provider || ':' || identity.provider_subject,
           identity.xmin::text
    FROM external_identities identity
    WHERE identity.user_id IN (SELECT user_id FROM relevant_accounts)
    UNION ALL SELECT 'auth_sessions', session.id, session.xmin::text
    FROM auth_sessions session
    WHERE session.user_id IN (SELECT user_id FROM relevant_accounts)
    UNION ALL SELECT 'user_blocks',
           block.blocker_user_id || ':' || block.blocked_user_id,
           block.xmin::text
    FROM user_blocks block
    WHERE block.blocker_user_id IN (SELECT user_id FROM relevant_accounts)
       OR block.blocked_user_id IN (SELECT user_id FROM relevant_accounts)
    ORDER BY table_name, row_key
  `, [matchIds]);
  return sha256({
    snapshotRows: snapshotRows.rows,
    identities: identities.rows,
    comments: comments.rows,
    reports: reports.rows,
    accountsAndBlocks: accountsAndBlocks.rows
  });
}

async function matchRevisionCount(
  database: PostgresDatabase,
  tournamentId: string,
  matchId: string
): Promise<number> {
  const result = await database.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM engine_match_revisions
    WHERE tournament_id = $1::uuid AND match_id = $2::uuid
  `, [tournamentId, matchId]);
  return Number(result.rows[0]?.count ?? 0);
}

async function lifecycleCounts(database: PostgresDatabase, tournamentId: string) {
  const result = await database.query<{
    match_revisions: string;
    projections: string;
  }>(`
    SELECT
      (SELECT count(*)::text FROM engine_match_revisions
       WHERE tournament_id = $1::uuid) AS match_revisions,
      (SELECT count(*)::text FROM engine_projection_versions
       WHERE tournament_id = $1::uuid) AS projections
  `, [tournamentId]);
  return {
    matchRevisionCount: Number(result.rows[0]?.match_revisions ?? 0),
    projectionCount: Number(result.rows[0]?.projections ?? 0)
  };
}

function eventCounts(events: readonly unknown[]) {
  const tournamentEvents = events.filter(
    (event) => eventType(event) === "tournament.updated"
  ).length;
  const matchEvents = events.filter(
    (event) => eventType(event) === "match.updated"
  ).length;
  return {
    tournamentEvents,
    matchEvents,
    allVersionPinned: events.length > 0 && events.every(
      (event) => Number.isSafeInteger(eventVersion(event)) &&
        Number(eventVersion(event)) > 0
    )
  };
}

function eventType(event: unknown): unknown {
  return isRecord(event) ? event.type : undefined;
}

function eventVersion(event: unknown): unknown {
  return isRecord(event) ? event.projectionVersion : undefined;
}

function validateInput(input: PostgresFullLifecycleRehearsalInput): void {
  requireCondition(
    input.databaseUrl.trim().length > 0 &&
      input.expectedDatabaseName.trim().length > 0,
    "database_configuration_missing"
  );
  requireCondition(
    RESTORE_SCOPED_DATABASE.test(input.expectedDatabaseName) &&
      !PROTECTED_DATABASE_NAMES.has(input.expectedDatabaseName.toLowerCase()),
    "database_name_not_restore_scoped"
  );
  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(input.databaseUrl);
  } catch {
    throw new RehearsalFailure("restored_database_url_invalid");
  }
  requireCondition(
    parsedDatabaseUrl.protocol === "postgres:" ||
      parsedDatabaseUrl.protocol === "postgresql:",
    "restored_database_protocol_invalid"
  );
  let urlDatabaseName: string;
  try {
    const path = parsedDatabaseUrl.pathname.startsWith("/")
      ? parsedDatabaseUrl.pathname.slice(1)
      : parsedDatabaseUrl.pathname;
    urlDatabaseName = decodeURIComponent(path);
  } catch {
    throw new RehearsalFailure("restored_database_name_invalid");
  }
  requireCondition(
    urlDatabaseName === input.expectedDatabaseName &&
      !urlDatabaseName.includes("/") &&
      parsedDatabaseUrl.searchParams.get("database") === null &&
      parsedDatabaseUrl.searchParams.get("dbname") === null,
    "database_url_name_mismatch"
  );
  const ordinaryDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (ordinaryDatabaseUrl) {
    let normalizedOrdinaryUrl: string;
    try {
      normalizedOrdinaryUrl = new URL(ordinaryDatabaseUrl).toString();
    } catch {
      throw new RehearsalFailure("ordinary_database_url_invalid");
    }
    requireCondition(
      normalizedOrdinaryUrl === parsedDatabaseUrl.toString(),
      "ordinary_database_url_conflicts"
    );
  }
  requireCondition(
    isStableUuid(input.administratorId),
    "administrator_id_invalid"
  );
  requireCondition(
    input.legacyTournamentId.trim().length > 0 &&
      input.legacyTournamentId.length <= 200,
    "legacy_tournament_id_invalid"
  );
  requireCondition(
    /^[a-f0-9]{40,64}$/u.test(input.candidateCommitSha),
    "candidate_sha_invalid"
  );
}

async function guarded<T>(
  evidenceCode: string,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RehearsalFailure) throw error;
    const safeCode = safeErrorCode(error);
    throw new RehearsalFailure(
      safeCode === undefined ? evidenceCode : `${evidenceCode}_${safeCode}`
    );
  }
}

function safeErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const details = error.details;
  if (Array.isArray(details)) {
    const detailCode = details.find((detail) =>
      isRecord(detail) && isSafeEvidenceCode(detail.code)
    );
    if (isRecord(detailCode) && typeof detailCode.code === "string") {
      if (typeof detailCode.message === "string") {
        const messageCode = SAFE_PROGRESSION_DETAIL_CODES.get(
          detailCode.message
        );
        if (messageCode !== undefined) return messageCode;
      }
      return detailCode.code.toLowerCase();
    }
  }
  if (typeof error.code === "string" && /^[0-9A-Z]{5}$/u.test(error.code)) {
    const constraint = typeof error.constraint === "string" &&
      /^[a-z][a-z0-9_]{1,100}$/u.test(error.constraint)
      ? `_${error.constraint}`
      : "";
    return `sqlstate_${error.code.toLowerCase()}${constraint}`;
  }
  return isSafeEvidenceCode(error.code)
    ? error.code.toLowerCase()
    : undefined;
}

function isSafeEvidenceCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{1,80}$/u.test(value);
}

function requireCondition(
  condition: unknown,
  evidenceCode: string
): asserts condition {
  if (!condition) throw new RehearsalFailure(evidenceCode);
}

function sha256(value: unknown): string {
  return createDigest(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
