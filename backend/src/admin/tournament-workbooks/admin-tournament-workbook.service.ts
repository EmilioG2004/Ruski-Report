import { randomUUID } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";

import { AppError } from "../../errors";
import {
  parseStableUuid,
  TournamentId
} from "../../tournament-engine/domain";
import { createUuidV5 } from "../../tournament-engine/scheduling/uuid-v5";
import {
  previewWorkbookCandidate,
  WorkbookCandidateScoringPreview
} from "../../tournament-engine/scoring";
import {
  CANONICAL_SCORECARD_LAYOUT_VERSION,
  CANONICAL_WORKBOOK_MAGIC,
  CANONICAL_WORKBOOK_SCHEMA_VERSION,
  CanonicalMatchReconciliationScope,
  CanonicalWorkbookGenerationError,
  CanonicalWorkbookParser,
  CanonicalWorkbookScope,
  canonicalSha256,
  compareWorkbookFormulaSummaries,
  createWorkbookReconciliationPreview,
  deriveWorkbookFormulaScoringImpact,
  digestWorkbookParticipants,
  digestWorkbookValue,
  ExplicitBlankAssignment,
  GeneratedWorkbookArtifactRecord,
  GeneratedWorkbookManifestSheetRecord,
  GeneratedWorkbookSheetInput,
  generateCanonicalTournamentWorkbook,
  planWorkbookImportApply,
  ParsedCanonicalScorecardSheet,
  ParsedCanonicalWorkbook,
  ParsedCanonicalWorkbookManifestEntry,
  PostgresWorkbookReconciliationRepository,
  WorkbookGenerationSourceRecord,
  WorkbookFormulaSummaryObservation,
  WorkbookImportObservationInput,
  WorkbookImportObservationRecord,
  WorkbookImportPreviewRecord,
  WorkbookIssue,
  WorkbookMatchRevisionCandidate,
  WorkbookObservationValidationIssue,
  WorkbookReconciliationPreview,
  WorkbookRevisionCandidateInput,
  WorkbookSheetObservation
} from "../../tournament-engine/workbook";
import {
  EnginePersistenceConflictError,
  EnginePersistenceInvariantError,
  EngineWriterLeaseConflictError
} from "../../tournament-engine/persistence";
import { AdministratorPrincipal } from "../security";
import {
  AdminTournamentWorkbookGenerationResponse,
  AdminTournamentWorkbookImportPreviewResponse,
  AdminTournamentWorkbookImportResultResponse,
  ApplyAdminWorkbookImportRequest,
  AssignAdminWorkbookSheetsRequest,
  GenerateAdminTournamentWorkbookRequest,
  UploadedCanonicalWorkbookFile
} from "./admin-tournament-workbook.contracts";
import {
  parseGenerateWorkbookRequest,
  parseWorkbookApplyRequest,
  parseWorkbookAssignmentsRequest
} from "./admin-tournament-workbook.validator";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PREVIEW_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1_000;

@Injectable()
export class AdminTournamentWorkbookService {
  private readonly parser = new CanonicalWorkbookParser();

  constructor(
    private readonly repository: PostgresWorkbookReconciliationRepository
  ) {}

  async listGenerations(
    tournamentIdValue: string
  ): Promise<AdminTournamentWorkbookGenerationResponse[]> {
    const tournamentId = tournamentIdValueOf(tournamentIdValue);
    return (await this.repository.listGeneratedWorkbooks(tournamentId))
      .map((workbook) => mapGeneration(workbook));
  }

  async generate(
    tournamentIdValue: string,
    request: GenerateAdminTournamentWorkbookRequest | null | undefined,
    principal: AdministratorPrincipal
  ): Promise<AdminTournamentWorkbookGenerationResponse> {
    const tournamentId = tournamentIdValueOf(tournamentIdValue);
    const { expectedTournamentRowVersion } = parseGenerateWorkbookRequest(request);
    const source = await this.requireSource(tournamentId);
    if (source.tournament.rowVersion !== expectedTournamentRowVersion) {
      throw conflict(
        "Tournament changed before workbook generation.",
        "STALE_TOURNAMENT_VERSION"
      );
    }

    const workbookId = randomUUID();
    const generatedAt = new Date().toISOString();
    const sourceDigest = generationSourceDigest(source);
    let generated;
    try {
      generated = await generateCanonicalTournamentWorkbook({
      generation: {
        id: workbookId,
        revision: source.nextGenerationRevision,
        sourceDigest,
        generatedAt
      },
      tournament: {
        id: source.tournament.tournamentId,
        name: source.tournament.name,
        year: source.tournament.year,
        lifecycle: source.tournament.lifecycle
      },
      pods: source.pods.map((pod) => ({
        id: parseStableUuid(pod.podId, "pod"),
        name: pod.name,
        sequence: pod.sequence
      })),
      teams: source.teams.map((team) => ({
        id: parseStableUuid(team.teamId, "tournament_team"),
        name: team.name,
        sequence: team.sequence,
        podId: parseStableUuid(team.podId, "pod"),
        initialSeed: team.initialSeed,
        players: team.players.map((player) => ({
          id: parseStableUuid(player.playerId, "tournament_player"),
          rosterMembershipId: parseStableUuid(
            player.rosterMembershipId,
            "roster_membership"
          ),
          rosterSlot: player.rosterSlot,
          displayName: player.displayName
        }))
      })),
      matches: source.matches.flatMap((match) => {
        if (match.stage !== "pod_play" || match.podId === null) {
          return [];
        }
        return [{
          id: parseStableUuid(match.matchId, "match"),
          podId: parseStableUuid(match.podId, "pod"),
          stage: "pod_play" as const,
          sequence: match.sequence,
          sequenceInPod: match.sequenceInPod,
          roundNumber: match.roundNumber,
          gameNumberForPair: match.gameNumberForPair,
          participantTeamIds: [
            parseStableUuid(match.participantTeamIds[0], "tournament_team"),
            parseStableUuid(match.participantTeamIds[1], "tournament_team")
          ] as const,
          participantRosters: [
            generationRoster(match.participantTeams[0]),
            generationRoster(match.participantTeams[1])
          ]
        }];
      })
      });
    } catch (error) {
      throw mapWorkbookError(error);
    }

    try {
      const stored = await this.repository.storeGeneratedWorkbook({
        workbookId,
        tournamentId,
        generationRevision: source.nextGenerationRevision,
        workbookSchemaVersion: CANONICAL_WORKBOOK_SCHEMA_VERSION,
        generationKind: "setup",
        sourceTournamentRowVersion: source.tournament.rowVersion,
        sourceDigest,
        artifact: generated.buffer,
        artifactDigest: generated.sha256,
        filename: generatedFilename(source, source.nextGenerationRevision),
        generatedByAdminId: principal.administratorId,
        generatedAt,
        sheets: generated.manifest.flatMap<GeneratedWorkbookSheetInput>((sheet) => {
          if (sheet.sheetKind === "metadata") {
            return [];
          }
          const sheetId = createUuidV5(
            workbookId,
            `sheet|${sheet.sheetKind === "game" ? sheet.matchId : sheet.sheetKind}`
          );
          if (sheet.sheetKind === "control") {
            return [{
              sheetId,
              sheetOrdinal: sheet.order,
              sheetKind: "control" as const,
              sheetName: sheet.sheetName,
              baselineFingerprint: null
            }];
          }
          if (sheet.sheetKind === "blank") {
            return [{
              sheetId,
              sheetOrdinal: sheet.order,
              sheetKind: "blank" as const,
              sheetName: sheet.sheetName,
              baselineFingerprint: sheet.baselineFingerprint
            }];
          }
          const match = source.matches.find((item) => item.matchId === sheet.matchId);
          if (match === undefined || sheet.baselineFingerprint === null) {
            throw new Error("Generated workbook manifest lost its source match.");
          }
          const participants = candidateTeams(
            source,
            match.participantTeamIds,
            match
          );
          return [{
            sheetId,
            sheetOrdinal: sheet.order,
            sheetKind: "game" as const,
            sheetName: sheet.sheetName,
            matchId: match.matchId,
            generatedMatchRowVersion: match.rowVersion,
            participantTeamIds: match.participantTeamIds,
            participantDigest: digestParticipants(participants),
            baselineFingerprint: sheet.baselineFingerprint
          }];
        }),
        audit: { eventId: randomUUID() }
      });
      return mapGeneration(stored.workbook);
    } catch (error) {
      throw mapWorkbookError(error);
    }
  }

  async download(
    tournamentIdValue: string,
    workbookIdValue: string
  ): Promise<GeneratedWorkbookArtifactRecord> {
    const tournamentId = tournamentIdValueOf(tournamentIdValue);
    const workbookId = stableUuid(workbookIdValue, "workbookId");
    const workbook = await this.repository.findGeneratedWorkbookArtifact(
      tournamentId,
      workbookId
    );
    if (workbook === null) {
      throw notFound("Generated workbook was not found.");
    }
    return workbook;
  }

  async preview(
    tournamentIdValue: string,
    file: UploadedCanonicalWorkbookFile | undefined,
    principal: AdministratorPrincipal
  ): Promise<AdminTournamentWorkbookImportPreviewResponse> {
    const tournamentId = tournamentIdValueOf(tournamentIdValue);
    assertCanonicalUpload(file);
    const receivedAt = new Date().toISOString();
    let identity;
    try {
      identity = await this.parser.readIdentity(file.buffer);
    } catch (error) {
      throw mapWorkbookError(error);
    }
    if (identity.tournamentId !== tournamentId) {
      throw validation(
        "Workbook belongs to another tournament.",
        "WORKBOOK_TOURNAMENT_MISMATCH"
      );
    }
    const artifact = await this.repository.findGeneratedWorkbookArtifact(
      tournamentId,
      identity.generationId
    );
    if (artifact === null) {
      throw validation(
        "Workbook generation is not recognized for this tournament.",
        "WORKBOOK_GENERATION_NOT_FOUND"
      );
    }
    const source = await this.requireSource(tournamentId);
    const scope = reconciliationScope(source, artifact);
    let parsed;
    let preview;
    try {
      parsed = await this.parser.parse({ buffer: file.buffer, scope });
      preview = createWorkbookReconciliationPreview({ parsed, scope });
    } catch (error) {
      throw mapWorkbookError(error);
    }
    const stored = await this.repository.createImportPreview({
      batchId: randomUUID(),
      tournamentId,
      workbookId: artifact.workbookId,
      workbookSchemaVersion: artifact.workbookSchemaVersion,
      sourceWorkbookDigest: parsed.checksum,
      sourceSizeBytes: file.size,
      baseTournamentRowVersion: source.tournament.rowVersion,
      previewDigest: preview.previewDigest,
      status: previewStatus(preview),
      receivedByAdminId: principal.administratorId,
      receivedAt,
      previewedAt: new Date().toISOString(),
      observations: persistenceObservations(preview, parsed.scorecards, artifact, source),
      audit: { eventId: randomUUID() }
    }).catch((error) => {
      throw mapWorkbookError(error);
    });
    return mapPreview(stored, source);
  }

  async findPreview(
    tournamentIdValue: string,
    batchIdValue: string
  ): Promise<AdminTournamentWorkbookImportPreviewResponse> {
    const tournamentId = tournamentIdValueOf(tournamentIdValue);
    const batch = await this.requirePreview(tournamentId, batchIdValue);
    const source = await this.requireSource(tournamentId);
    return mapPreview(batch, source);
  }

  async assign(
    tournamentIdValue: string,
    batchIdValue: string,
    request: AssignAdminWorkbookSheetsRequest | null | undefined,
    principal: AdministratorPrincipal
  ): Promise<AdminTournamentWorkbookImportPreviewResponse> {
    const tournamentId = tournamentIdValueOf(tournamentIdValue);
    const prior = await this.requirePreview(tournamentId, batchIdValue);
    const parsedRequest = parseWorkbookAssignmentsRequest(request);
    if (parsedRequest.expectedPreviewDigest !== undefined &&
        parsedRequest.expectedPreviewDigest !== prior.previewDigest) {
      throw conflict("Workbook preview is stale.", "PREVIEW_DIGEST_MISMATCH");
    }
    const source = await this.requireSource(tournamentId);
    const artifact = await this.requireArtifact(tournamentId, prior.workbookId);
    const scope = reconciliationScope(source, artifact);
    const parsed = reconstructParsedWorkbook(prior, artifact, source);
    const assignments = resolveAssignments(prior, parsedRequest.assignments);
    const preview = createWorkbookReconciliationPreview({
      parsed,
      scope,
      assignments
    });
    const stored = await this.repository.reviseImportPreview({
      batchId: randomUUID(),
      tournamentId,
      supersedesBatchId: prior.batchId,
      previewDigest: preview.previewDigest,
      status: previewStatus(preview),
      revisedByAdminId: principal.administratorId,
      previewedAt: new Date().toISOString(),
      observations: persistenceObservations(
        preview,
        parsed.scorecards,
        artifact,
        source
      ),
      audit: { eventId: randomUUID() }
    }).catch((error) => {
      throw mapWorkbookError(error);
    });
    return mapPreview(stored, source);
  }

  async apply(
    tournamentIdValue: string,
    batchIdValue: string,
    request: ApplyAdminWorkbookImportRequest | null | undefined,
    principal: AdministratorPrincipal
  ): Promise<AdminTournamentWorkbookImportResultResponse> {
    const tournamentId = tournamentIdValueOf(tournamentIdValue);
    const batch = await this.requirePreview(tournamentId, batchIdValue);
    const parsed = parseWorkbookApplyRequest(request);
    const source = await this.requireSource(tournamentId);
    const preview = reconciliationPreviewFromRecord(batch);
    try {
      const plan = planWorkbookImportApply({
        preview,
        expectedPreviewDigest: parsed.previewDigest,
        selectedObservationIds: parsed.acceptedObservationIds,
        correctionReasons: Object.entries(parsed.correctionReasons).map(
          ([observationId, reason]) => ({ observationId, reason })
        ),
        currentMatches: reconciliationMatches(source)
      });
      if (!sameSet(plan.skippedObservationIds, parsed.skippedObservationIds)) {
        throw validation(
          "Accepted and skipped workbook observations are incomplete.",
          "WORKBOOK_SELECTION_INCOMPLETE"
        );
      }
      const result = await this.repository.confirmImport({
        tournamentId,
        batchId: batch.batchId,
        previewDigest: parsed.previewDigest,
        confirmationDigest: plan.confirmationDigest,
        acceptedObservationIds: parsed.acceptedObservationIds,
        skippedObservationIds: parsed.skippedObservationIds,
        correctionReasons: parsed.correctionReasons,
        confirmedByAdminId: principal.administratorId,
        audit: { eventId: randomUUID() }
      });
      return {
        id: result.batchId,
        tournamentId: result.tournamentId,
        status: result.status,
        acceptedCount: result.appliedMatchIds.length,
        skippedCount: result.skippedMatchIds.length,
        unchangedCount: result.unchangedMatchIds.length,
        missingNonDestructiveCount: result.missingMatchIds.length,
        materializedRevisions: result.materializedRevisions,
        tournamentStatisticRunId: result.tournamentStatisticRunId,
        tournamentStatisticRunDigest: result.tournamentStatisticRunDigest,
        appliedAt: result.completedAt
      };
    } catch (error) {
      throw mapWorkbookError(error);
    }
  }

  private async requireSource(
    tournamentId: TournamentId
  ): Promise<WorkbookGenerationSourceRecord> {
    try {
      const source = await this.repository.readGenerationSource(tournamentId);
      if (source === null) {
        throw notFound("Tournament was not found.");
      }
      return source;
    } catch (error) {
      throw mapWorkbookError(error);
    }
  }

  private async requirePreview(
    tournamentId: TournamentId,
    batchIdValue: string
  ): Promise<WorkbookImportPreviewRecord> {
    const batchId = stableUuid(batchIdValue, "batchId");
    const record = await this.repository.findImportPreview(tournamentId, batchId);
    if (record === null) {
      throw notFound("Workbook import preview was not found.");
    }
    return record;
  }

  private async requireArtifact(
    tournamentId: TournamentId,
    workbookId: string
  ): Promise<GeneratedWorkbookArtifactRecord> {
    const record = await this.repository.findGeneratedWorkbookArtifact(
      tournamentId,
      workbookId
    );
    if (record === null) {
      throw notFound("Generated workbook was not found.");
    }
    return record;
  }
}

function generationSourceDigest(source: WorkbookGenerationSourceRecord): string {
  return canonicalSha256({
    contract: "canonical-workbook-generation-source-v1",
    tournament: source.tournament,
    configuration: source.configuration,
    pods: source.pods,
    teams: source.teams,
    matches: source.matches.map(({ workbookState: _state, ...match }) => match)
  });
}

function generatedFilename(
  source: WorkbookGenerationSourceRecord,
  revision: number
): string {
  const slug = source.tournament.name.normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80) || "tournament";
  return `ruski-report-${source.tournament.year}-${slug}-r${revision}.xlsx`;
}

function mapGeneration(workbook: {
  workbookId: string;
  tournamentId: string;
  generationRevision: number;
  workbookSchemaVersion: number;
  sourceDigest: string;
  artifactDigest: string;
  artifactSizeBytes: number;
  filename: string;
  generatedAt: string;
}): AdminTournamentWorkbookGenerationResponse {
  return {
    id: workbook.workbookId,
    tournamentId: workbook.tournamentId,
    revision: workbook.generationRevision,
    schemaVersion: workbook.workbookSchemaVersion,
    sourceDigest: workbook.sourceDigest,
    artifactSha256: workbook.artifactDigest,
    sizeBytes: workbook.artifactSizeBytes,
    generatedAt: workbook.generatedAt,
    filename: workbook.filename,
    downloadUrl: `/api/admin/tournaments/${workbook.tournamentId}/workbooks/${workbook.workbookId}/download`
  };
}

function reconciliationScope(
  source: WorkbookGenerationSourceRecord,
  artifact: GeneratedWorkbookArtifactRecord
): CanonicalWorkbookScope {
  return {
    tournamentId: source.tournament.tournamentId,
    generation: {
      generationId: artifact.workbookId,
      generationRevision: artifact.generationRevision,
      generationSourceDigest: artifact.sourceDigest
    },
    manifest: trustedManifest(artifact, source),
    matches: reconciliationMatches(source)
  };
}

function reconciliationMatches(
  source: WorkbookGenerationSourceRecord
): CanonicalMatchReconciliationScope[] {
  return source.matches.map((match) => {
    const participants = candidateTeams(source, match.participantTeamIds, match)
      .flatMap((team) => team.players.map((player) => ({
        sideNumber: team.sideNumber,
        teamId: parseStableUuid(team.teamId, "tournament_team"),
        playerId: parseStableUuid(player.playerId, "tournament_player"),
        rosterMembershipId: parseStableUuid(
          player.rosterMembershipId,
          "roster_membership"
        ),
        rosterSlot: player.rosterSlot,
        displayName: player.displayName
      })));
    return {
      matchId: parseStableUuid(match.matchId, "match"),
      matchRowVersion: match.rowVersion,
      canonicalStatus: match.status,
      stage: match.stage,
      ...(match.podId === null
        ? {}
        : { podId: parseStableUuid(match.podId, "pod") }),
      teamIds: [
        parseStableUuid(match.participantTeamIds[0], "tournament_team"),
        parseStableUuid(match.participantTeamIds[1], "tournament_team")
      ],
      participants,
      ...(match.workbookState === null ? {} : {
        sourceState: {
          fingerprint: match.workbookState.activeFingerprint,
          candidateId: match.workbookState.activeCandidateId,
          sourceRevisionNumber: match.workbookState.sourceRevisionNumber,
          proposedStatus: match.workbookState.proposedStatus,
          participantDigest: match.workbookState.participantDigest,
          rowVersion: match.workbookState.rowVersion
        }
      })
    };
  });
}

function trustedManifest(
  artifact: GeneratedWorkbookArtifactRecord,
  source: WorkbookGenerationSourceRecord
): ParsedCanonicalWorkbookManifestEntry[] {
  return artifact.sheets.flatMap<ParsedCanonicalWorkbookManifestEntry>((sheet) => {
    if (sheet.sheetKind === "control" || sheet.baselineFingerprint === null) {
      return [];
    }
    if (sheet.sheetKind === "blank") {
      return [{
        sheetId: "blank-scorecard",
        sheetName: sheet.sheetName,
        sheetKind: "blank",
        baselineFingerprint: sheet.baselineFingerprint
      }];
    }
    if (sheet.matchId === null || sheet.participantTeamIds === null) {
      throw new Error("Stored game workbook manifest is incomplete.");
    }
    const match = source.matches.find((item) => item.matchId === sheet.matchId);
    if (match === undefined) {
      throw new Error("Stored game workbook manifest is outside current scope.");
    }
    return [{
      sheetId: `match:${sheet.matchId}`,
      sheetName: sheet.sheetName,
      sheetKind: "game",
      matchId: parseStableUuid(sheet.matchId, "match"),
      stage: match.stage,
      ...(match.podId === null
        ? {}
        : { podId: parseStableUuid(match.podId, "pod") }),
      teamIds: [
        parseStableUuid(sheet.participantTeamIds[0], "tournament_team"),
        parseStableUuid(sheet.participantTeamIds[1], "tournament_team")
      ],
      baselineFingerprint: sheet.baselineFingerprint
    }];
  });
}

function candidateTeams(
  source: WorkbookGenerationSourceRecord,
  teamIds: readonly [string, string],
  match?: WorkbookGenerationSourceRecord["matches"][number]
) {
  return teamIds.map((teamId, index) => {
    const team = match?.participantTeams.find((item) => item.teamId === teamId) ??
      source.teams.find((item) => item.teamId === teamId);
    if (team === undefined) {
      throw new Error("Match participant team is absent from workbook source.");
    }
    return {
      sideNumber: (index + 1) as 1 | 2,
      teamId: team.teamId,
      displayName: team.name,
      players: team.players.map((player) => ({
        playerId: player.playerId,
        rosterMembershipId: player.rosterMembershipId,
        rosterSlot: player.rosterSlot,
        displayName: player.displayName
      }))
    };
  });
}

function generationRoster(
  team: WorkbookGenerationSourceRecord["matches"][number]["participantTeams"][number]
) {
  return {
    teamId: parseStableUuid(team.teamId, "tournament_team"),
    players: team.players.map((player) => ({
      id: parseStableUuid(player.playerId, "tournament_player"),
      rosterMembershipId: parseStableUuid(
        player.rosterMembershipId,
        "roster_membership"
      ),
      rosterSlot: player.rosterSlot,
      displayName: player.displayName
    }))
  };
}

function digestParticipants(
  teams: ReturnType<typeof candidateTeams>
): string {
  return digestWorkbookParticipants(teams);
}

function persistenceObservations(
  preview: WorkbookReconciliationPreview,
  scorecards: readonly ParsedCanonicalScorecardSheet[],
  artifact: GeneratedWorkbookArtifactRecord,
  source: WorkbookGenerationSourceRecord
): WorkbookImportObservationInput[] {
  const sourceByIndex = new Map(scorecards.map((sheet) => [sheet.worksheetIndex, sheet]));
  return preview.observations.map((observation) => {
    const match = observation.matchId === undefined
      ? undefined
      : source.matches.find((item) => item.matchId === observation.matchId);
    const workbookSheet = trustedSheetForObservation(observation, artifact.sheets);
    if (observation.decision === "missing_non_destructive") {
      if (observation.matchId === undefined || match === undefined ||
          workbookSheet === undefined) {
        throw new Error("Missing workbook observation lost trusted identity.");
      }
      return {
        observationId: observation.id,
        observationKind: "missing" as const,
        workbookSheetId: workbookSheet.sheetId,
        matchId: match.matchId,
        assignmentSource: "none" as const,
        disposition: "missing" as const,
        baseMatchRowVersion: match.rowVersion,
        baseSourceStateVersion: match.workbookState?.rowVersion ?? 0,
        validationIssues: persistedIssues(observation.issues)
      };
    }
    if (observation.worksheetIndex === undefined) {
      throw new Error("Present workbook observation lost its worksheet ordinal.");
    }
    const sourceSheet = sourceByIndex.get(observation.worksheetIndex);
    if (sourceSheet === undefined) {
      throw new Error("Present workbook observation lost its normalized source.");
    }
    const formulaIssues = compareWorkbookFormulaSummaries(
      sourceSheet.formulaSummaryObservations ?? [],
      deriveWorkbookFormulaScoringImpact(
        sourceSheet.rows,
        sourceSheet.playersPerTeam
      )
    );
    const sourceEnvelope = jsonRecord({ sheet: sourceSheet });
    return {
      observationId: observation.id,
      observationKind: "present" as const,
      sheetOrdinal: observation.worksheetIndex + 1,
      ...(workbookSheet === undefined ? {} : { workbookSheetId: workbookSheet.sheetId }),
      ...(match === undefined ? {} : { matchId: match.matchId }),
      assignmentSource: observation.binding === "embedded_match_id"
        ? "stable_metadata" as const
        : observation.binding === "explicit_blank_assignment"
          ? "explicit_blank" as const
          : "none" as const,
      disposition: decisionDisposition(observation.decision),
      ...(observation.fingerprint === undefined
        ? {}
        : { fingerprint: observation.fingerprint }),
      ...(match === undefined ? {} : { baseMatchRowVersion: match.rowVersion }),
      baseSourceStateVersion: match?.workbookState?.rowVersion ?? 0,
      sourceEnvelopeSchemaVersion: 1,
      sourceEnvelope,
      sourceEnvelopeDigest: digestWorkbookValue(sourceEnvelope),
      validationIssues: persistedIssues([...observation.issues, ...formulaIssues]),
      ...(observation.candidate === undefined ? {} : {
        candidate: persistenceCandidate(observation.candidate, source)
      })
    };
  });
}

function persistenceCandidate(
  candidate: WorkbookMatchRevisionCandidate,
  source: WorkbookGenerationSourceRecord
): WorkbookRevisionCandidateInput {
  const match = source.matches.find((item) => item.matchId === candidate.matchId);
  if (match === undefined) {
    throw new Error("Workbook candidate match is absent from current source.");
  }
  const teams = candidateTeams(source, match.participantTeamIds, match);
  const envelope = jsonRecord({
    contract: "workbook-match-revision-candidate-v2",
    semanticCandidateId: candidate.id,
    tournamentId: candidate.tournamentId,
    matchId: candidate.matchId,
    sourceRevisionNumber: candidate.sourceRevisionNumber,
    previousCandidateId: candidate.previousCandidateId ?? null,
    fingerprint: candidate.fingerprint,
    proposedStatus: candidate.proposedStatus,
    proposedScoreAvailability: candidate.proposedScoreAvailability,
    reason: candidate.reason,
    participantDigest: candidate.participantDigest,
    participants: candidate.participants,
    rows: candidate.rawRows,
    formulaSummaryObservations: candidate.formulaSummaryObservations ?? []
  });
  return {
    candidateId: candidate.id,
    matchId: candidate.matchId,
    ...(candidate.previousCandidateId === undefined
      ? {}
      : { previousAppliedCandidateId: candidate.previousCandidateId }),
    sourceRevisionNumber: candidate.sourceRevisionNumber,
    fingerprint: candidate.fingerprint,
    proposedStatus: candidate.proposedStatus,
    proposedScoreAvailability: candidate.proposedScoreAvailability,
    reason: candidate.reason,
    requiresConfirmation: candidate.requiresConfirmation,
    expectedMatchRowVersion: candidate.expectedMatchRowVersion,
    expectedSourceStateVersion: candidate.expectedSourceStateRowVersion ?? 0,
    envelopeSchemaVersion: 2,
    envelope,
    envelopeDigest: digestWorkbookValue(envelope),
    participantDigest: candidate.participantDigest,
    teams
  };
}

function trustedSheetForObservation(
  observation: WorkbookSheetObservation,
  sheets: readonly GeneratedWorkbookManifestSheetRecord[]
) {
  if (observation.matchId !== undefined) {
    return sheets.find((sheet) => sheet.matchId === observation.matchId);
  }
  if (observation.sheetId === "blank-scorecard") {
    return sheets.find((sheet) => sheet.sheetKind === "blank");
  }
  return undefined;
}

function reconstructParsedWorkbook(
  batch: WorkbookImportPreviewRecord,
  artifact: GeneratedWorkbookArtifactRecord,
  source: WorkbookGenerationSourceRecord
): ParsedCanonicalWorkbook {
  const scorecards = batch.observations.flatMap((observation) => {
    const sheet = observation.sourceEnvelope?.sheet;
    return isObject(sheet) ? [sheet as never] : [];
  });
  return {
    checksum: batch.sourceWorkbookDigest,
    control: {
      magic: CANONICAL_WORKBOOK_MAGIC,
      workbookSchemaVersion: artifact.workbookSchemaVersion,
      scorecardLayoutVersion: CANONICAL_SCORECARD_LAYOUT_VERSION,
      tournamentId: artifact.tournamentId,
      generationId: artifact.workbookId,
      generationRevision: artifact.generationRevision,
      generationSourceDigest: artifact.sourceDigest,
      generatedAt: artifact.generatedAt
    },
    manifest: trustedManifest(artifact, source),
    scorecards,
    ignoredWorksheetNames: [],
    issues: []
  };
}

function resolveAssignments(
  batch: WorkbookImportPreviewRecord,
  assignments: Readonly<Record<string, string>>
): ExplicitBlankAssignment[] {
  const retained = batch.observations.flatMap((observation) => {
    const sheet = observation.sourceEnvelope?.sheet;
    const worksheetIndex = isObject(sheet) &&
      Number.isSafeInteger(sheet.worksheetIndex)
      ? Number(sheet.worksheetIndex)
      : undefined;
    return observation.assignmentSource === "explicit_blank" &&
      observation.matchId !== null && worksheetIndex !== undefined
      ? [{
          worksheetIndex,
          matchId: parseStableUuid(observation.matchId, "match")
        }]
      : [];
  });
  const added = Object.entries(assignments).map(([observationId, matchId]) => {
    const observation = batch.observations.find(
      (item) => item.observationId === observationId
    );
    const sheet = observation?.sourceEnvelope?.sheet;
    const worksheetIndex = isObject(sheet) &&
      Number.isSafeInteger(sheet.worksheetIndex)
      ? Number(sheet.worksheetIndex)
      : undefined;
    if (observation?.disposition !== "ambiguous" || worksheetIndex === undefined) {
      throw validation(
        "Only an unresolved copied blank scorecard may be assigned.",
        "WORKBOOK_ASSIGNMENT_NOT_AVAILABLE"
      );
    }
    return {
      worksheetIndex,
      matchId: parseStableUuid(matchId, "match")
    };
  });
  return [...retained, ...added];
}

function reconciliationPreviewFromRecord(
  batch: WorkbookImportPreviewRecord
): WorkbookReconciliationPreview {
  return {
    checksum: batch.sourceWorkbookDigest,
    previewDigest: batch.previewDigest,
    tournamentId: batch.tournamentId,
    generation: {
      generationId: batch.workbookId,
      generationRevision: 1,
      generationSourceDigest: "0".repeat(64)
    },
    observations: batch.observations.map(observationFromRecord),
    issues: [],
    applicable: batch.status === "preview_ready"
  };
}

function observationFromRecord(
  observation: WorkbookImportObservationRecord
): WorkbookSheetObservation {
  const candidate = observation.candidate === null
    ? undefined
    : candidateFromRecord(observation.candidate, observation.observationId);
  return {
    id: observation.observationId,
    ...(observation.sheetOrdinal === null
      ? {}
      : { worksheetIndex: observation.sheetOrdinal - 1 }),
    ...(observation.matchId === null
      ? {}
      : { matchId: parseStableUuid(observation.matchId, "match") }),
    ...(observation.fingerprint === null
      ? {}
      : { fingerprint: observation.fingerprint }),
    decision: recordDecision(observation.disposition),
    issues: observation.validationIssues,
    ...(candidate === undefined ? {} : { candidate })
  };
}

function candidateFromRecord(
  candidate: WorkbookRevisionCandidateInput,
  _observationId: string
): WorkbookMatchRevisionCandidate {
  const rows = candidate.envelope.rows;
  if (!Array.isArray(rows)) {
    throw new Error("Stored workbook candidate rows are invalid.");
  }
  const formulaSummaryObservations = storedFormulaSummaryObservations(
    candidate.envelope
  );
  return {
    id: candidate.candidateId,
    tournamentId: parseStableUuid(
      String(candidate.envelope.tournamentId),
      "tournament"
    ),
    matchId: parseStableUuid(candidate.matchId, "match"),
    sourceRevisionNumber: candidate.sourceRevisionNumber,
    ...(candidate.previousAppliedCandidateId === undefined
      ? {}
      : { previousCandidateId: candidate.previousAppliedCandidateId }),
    fingerprint: candidate.fingerprint,
    proposedStatus: candidate.proposedStatus,
    proposedScoreAvailability: candidate.proposedScoreAvailability,
    reason: candidate.reason,
    requiresConfirmation: candidate.requiresConfirmation,
    requiresCorrectionReason: candidate.reason === "correction",
    expectedMatchRowVersion: candidate.expectedMatchRowVersion,
    ...(candidate.expectedSourceStateVersion === 0
      ? {}
      : { expectedSourceStateRowVersion: candidate.expectedSourceStateVersion }),
    participantDigest: candidate.participantDigest,
    participants: candidate.teams.flatMap((team) => team.players.map((player) => ({
      sideNumber: team.sideNumber,
      teamId: parseStableUuid(team.teamId, "tournament_team"),
      playerId: parseStableUuid(player.playerId, "tournament_player"),
      rosterMembershipId: parseStableUuid(
        player.rosterMembershipId,
        "roster_membership"
      ),
      rosterSlot: player.rosterSlot,
      displayNameAtImport: player.displayName
    }))),
    rawRows: rows as never,
    formulaSummaryObservations
  };
}

function storedFormulaSummaryObservations(
  envelope: Readonly<Record<string, unknown>>
): readonly WorkbookFormulaSummaryObservation[] {
  const contract = envelope.contract;
  if (contract === "workbook-match-revision-candidate-v1") {
    return [];
  }
  if (contract !== "workbook-match-revision-candidate-v2" ||
      !Array.isArray(envelope.formulaSummaryObservations)) {
    throw new Error("Stored workbook candidate envelope is unsupported.");
  }
  return envelope.formulaSummaryObservations.map((value) => {
    if (!isObject(value) ||
        (value.sideNumber !== 1 && value.sideNumber !== 2) ||
        (value.subjectType !== "player" && value.subjectType !== "team") ||
        !isFormulaMetric(value.metric) ||
        !["exact", "changed", "missing"].includes(String(value.formulaState)) ||
        !(value.cachedValue === null || (
          typeof value.cachedValue === "number" &&
          Number.isFinite(value.cachedValue)
        )) ||
        !(value.rosterSlot === undefined || (
          Number.isSafeInteger(value.rosterSlot) && Number(value.rosterSlot) > 0
        ))) {
      throw new Error("Stored workbook formula summary is invalid.");
    }
    return {
      sideNumber: value.sideNumber as 1 | 2,
      subjectType: value.subjectType as "player" | "team",
      ...(value.rosterSlot === undefined
        ? {}
        : { rosterSlot: Number(value.rosterSlot) }),
      metric: value.metric,
      formulaState: value.formulaState as "exact" | "changed" | "missing",
      cachedValue: value.cachedValue
    };
  });
}

function isFormulaMetric(value: unknown): value is
  "misses" | "makes" | "splashOuts" | "guys" | "tris" | "dis" | "voms" |
  "shootingPercentage" {
  return typeof value === "string" && [
    "misses", "makes", "splashOuts", "guys", "tris", "dis", "voms",
    "shootingPercentage"
  ].includes(value);
}

function mapPreview(
  batch: WorkbookImportPreviewRecord,
  source: WorkbookGenerationSourceRecord
): AdminTournamentWorkbookImportPreviewResponse {
  const hasAssignments = batch.observations.some(
    (observation) => observation.disposition === "ambiguous"
  );
  const expired = batch.status === "preview_ready" &&
    Date.parse(batch.previewExpiresAt) <= Date.now();
  const status = expired
    ? "expired"
    : hasAssignments
    ? "assignment_required"
    : batch.status === "superseded" ? "expired" : batch.status;
  const observations = batch.observations
    .filter((observation) => observation.observationKind === "present")
    .map((observation) => {
      const sourceSheet = observation.sourceEnvelope?.sheet;
      const label = isObject(sourceSheet) && typeof sourceSheet.worksheetName === "string"
        ? sourceSheet.worksheetName
        : `Sheet ${observation.sheetOrdinal ?? "?"}`;
      const match = observation.matchId === null
        ? undefined
        : source.matches.find((item) => item.matchId === observation.matchId);
      const teams = match === undefined
        ? []
        : match.participantTeamIds.flatMap((teamId) => {
          const team = source.teams.find((item) => item.teamId === teamId);
          return team === undefined ? [] : [team.name];
        });
      const proposedImpact = observation.candidate === null
        ? null
        : proposedScoringImpact(observation.candidate);
      return {
        id: observation.observationId,
        ordinal: observation.sheetOrdinal ?? 0,
        label,
        classification: responseClassification(observation.disposition),
        matchId: observation.matchId,
        matchLabel: teams.length === 2 ? `${teams[0]} vs ${teams[1]}` : null,
        proposedStatus: responseProposedStatus(
          observation.candidate?.proposedStatus
        ),
        proposedScoreAvailability: responseScoreAvailability(
          observation.candidate?.proposedScoreAvailability
        ),
        currentImpact: match?.activeScoringPreview ?? null,
        proposedImpact,
        correction: observation.candidate?.reason === "correction",
        issues: observation.validationIssues.map((issue) => ({
          ...issue,
          observationId: observation.observationId
        }))
      };
    });
  const assignedMatchIds = new Set(batch.observations.flatMap((item) =>
    item.observationKind === "missing" || item.matchId === null
      ? []
      : [item.matchId]
  ));
  return {
    id: batch.batchId,
    tournamentId: batch.tournamentId,
    sourceGenerationId: batch.workbookId,
    status,
    previewDigest: batch.previewDigest,
    expiresAt: batch.previewExpiresAt,
    counts: {
      unchanged: batch.counts.unchanged,
      proposed: batch.counts.proposed,
      invalid: batch.observations.filter((item) => item.disposition === "invalid").length,
      unresolved: batch.observations.filter((item) => item.disposition === "ambiguous").length,
      missingNonDestructive: batch.counts.missing
    },
    observations,
    assignableMatches: source.matches
      .filter((match) => !assignedMatchIds.has(match.matchId))
      .map((match) => ({
        id: match.matchId,
        label: matchLabel(match.participantTeamIds, source)
      })),
    issues: batch.status === "preview_rejected" ? [{
      code: "WORKBOOK_PREVIEW_REJECTED",
      message: "Workbook preview contains validation errors.",
      severity: "error"
    }] : []
  };
}

function proposedScoringImpact(
  candidate: WorkbookRevisionCandidateInput
) {
  const preview = previewWorkbookCandidate(candidate);
  const totalsByTeam = new Map(
    preview.reduction.teams.map((team) => [team.teamId, team.totals])
  );
  return {
    teams: preview.teams.map((team) => ({
      sideNumber: team.sideNumber,
      teamId: team.teamId,
      score: team.score ?? null,
      result: team.result,
      totals: totalsByTeam.get(team.teamId) ?? emptyScoringTotals()
    })),
    matchTotals: preview.reduction.match,
    winnerTeamId: preview.winnerTeamId ?? null
  };
}

function emptyScoringTotals(): WorkbookCandidateScoringPreview["reduction"]["match"] {
  return {
    attempts: 0,
    makes: 0,
    misses: 0,
    shootingPercentage: null,
    splashOuts: 0,
    guys: 0,
    tris: 0,
    dis: 0,
    voms: 0,
    cupsScored: 0
  };
}

function matchLabel(
  teamIds: readonly [string, string],
  source: WorkbookGenerationSourceRecord
): string {
  return teamIds.map((teamId) =>
    source.teams.find((team) => team.teamId === teamId)?.name ?? "Unknown team"
  ).join(" vs ");
}

function previewStatus(preview: WorkbookReconciliationPreview) {
  const rejected = !preview.applicable || preview.observations.some(
    (observation) => observation.decision === "invalid"
  );
  return rejected ? "preview_rejected" as const : "preview_ready" as const;
}

function decisionDisposition(decision: WorkbookSheetObservation["decision"]) {
  switch (decision) {
    case "proposed": return "proposed" as const;
    case "unchanged": return "unchanged" as const;
    case "unresolved": return "ambiguous" as const;
    case "invalid": return "invalid" as const;
    case "missing_non_destructive": return "invalid" as const;
  }
}

function recordDecision(
  disposition: WorkbookImportObservationRecord["disposition"]
): WorkbookSheetObservation["decision"] {
  switch (disposition) {
    case "proposed": return "proposed";
    case "unchanged": return "unchanged";
    case "invalid": return "invalid";
    case "ambiguous": return "unresolved";
    case "missing": return "missing_non_destructive";
  }
}

function responseClassification(
  disposition: WorkbookImportObservationRecord["disposition"]
) {
  switch (disposition) {
    case "ambiguous": return "unresolved" as const;
    case "proposed": return "proposed" as const;
    case "unchanged": return "unchanged" as const;
    case "invalid":
    case "missing": return "invalid" as const;
  }
}

function persistedIssues(
  issues: readonly WorkbookIssue[]
): WorkbookObservationValidationIssue[] {
  return issues.slice(0, 100).map((issue) => ({
    code: /^[A-Z][A-Z0-9_]{1,79}$/u.test(issue.code)
      ? issue.code
      : "WORKBOOK_VALIDATION_ISSUE",
    severity: issue.severity,
    message: issue.message.slice(0, 500),
    ...(issue.path === undefined ? {} : { path: issue.path.slice(0, 240) })
  }));
}

function responseProposedStatus(
  value: string | undefined
): "scheduled" | "in_progress" | "final" | null {
  return value === "scheduled" || value === "in_progress" || value === "final"
    ? value
    : null;
}

function responseScoreAvailability(
  value: string | undefined
): "not_started" | "partial" | "complete" | "unrecorded" | null {
  return value === "not_started" || value === "partial" ||
    value === "complete" || value === "unrecorded"
    ? value
    : null;
}

function jsonRecord(value: unknown): Readonly<Record<string, unknown>> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function assertCanonicalUpload(
  file: UploadedCanonicalWorkbookFile | undefined
): asserts file is UploadedCanonicalWorkbookFile {
  if (file === undefined) {
    throw validation(
      "Workbook upload requires a multipart file field named file.",
      "WORKBOOK_FILE_REQUIRED"
    );
  }
  if (!file.originalname.toLowerCase().endsWith(".xlsx") ||
      file.mimetype !== XLSX_MIME) {
    throw validation(
      "Workbook upload must be an .xlsx Open XML spreadsheet.",
      "WORKBOOK_FILE_TYPE_INVALID"
    );
  }
  if (file.size !== file.buffer.byteLength || file.size < 1 ||
      file.size > 10 * 1024 * 1024) {
    throw validation(
      "Workbook upload size is invalid.",
      "WORKBOOK_FILE_SIZE_INVALID"
    );
  }
  const signature = file.buffer.subarray(0, 4).toString("hex");
  if (!["504b0304", "504b0506", "504b0708"].includes(signature)) {
    throw validation(
      "Workbook upload is not a valid Open XML package.",
      "WORKBOOK_FILE_SIGNATURE_INVALID"
    );
  }
}

function stableUuid(value: string, path: string): string {
  try {
    return parseStableUuid(value, "tournament");
  } catch {
    throw new AppError({
      code: "BAD_REQUEST",
      message: "A stable non-nil UUID is required.",
      statusCode: HttpStatus.BAD_REQUEST,
      details: [{
        code: "STABLE_ID_INVALID",
        message: "A stable non-nil UUID is required.",
        path
      }]
    });
  }
}

function tournamentIdValueOf(value: string): TournamentId {
  try {
    return parseStableUuid(value, "tournament");
  } catch {
    throw new AppError({
      code: "BAD_REQUEST",
      message: "Tournament ID must be a non-nil UUID.",
      statusCode: HttpStatus.BAD_REQUEST,
      details: [{
        code: "INVALID_TOURNAMENT_ID",
        message: "Tournament ID is invalid.",
        path: "tournamentId"
      }]
    });
  }
}

function mapWorkbookError(error: unknown): unknown {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof EngineWriterLeaseConflictError) {
    return conflict(error.message, "WORKBOOK_WRITER_CONFLICT");
  }
  if (error instanceof EnginePersistenceConflictError) {
    return conflict(error.message, "WORKBOOK_STATE_CONFLICT");
  }
  if (error instanceof EnginePersistenceInvariantError) {
    return validation(error.message, "WORKBOOK_INVARIANT_FAILED");
  }
  if (error instanceof CanonicalWorkbookGenerationError) {
    return validation(
      "Canonical workbook cannot be generated from this tournament setup.",
      "WORKBOOK_GENERATION_UNSUPPORTED"
    );
  }
  if (isWorkbookIssueError(error)) {
    return new AppError({
      code: "VALIDATION_FAILED",
      message: "Workbook could not be reconciled.",
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      details: error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path
      }))
    });
  }
  if (isWorkbookSafetyError(error)) {
    return validation(
      "Workbook package is invalid or unsafe.",
      error.issue.code
    );
  }
  return error;
}

function isWorkbookIssueError(error: unknown): error is {
  issues: readonly WorkbookIssue[];
} {
  return typeof error === "object" && error !== null &&
    Array.isArray((error as { issues?: unknown }).issues);
}

function isWorkbookSafetyError(error: unknown): error is {
  issue: WorkbookIssue;
} {
  return typeof error === "object" && error !== null &&
    isObject((error as { issue?: unknown }).issue) &&
    typeof (error as { issue: { code?: unknown } }).issue.code === "string";
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value) => right.includes(value));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function notFound(message: string): AppError {
  return new AppError({
    code: "NOT_FOUND",
    message,
    statusCode: HttpStatus.NOT_FOUND
  });
}

function validation(message: string, detailCode: string): AppError {
  return new AppError({
    code: "VALIDATION_FAILED",
    message,
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    details: [{ code: detailCode, message }]
  });
}

function conflict(message: string, detailCode: string): AppError {
  return new AppError({
    code: "CONFLICT",
    message,
    statusCode: HttpStatus.CONFLICT,
    details: [{ code: detailCode, message }]
  });
}
