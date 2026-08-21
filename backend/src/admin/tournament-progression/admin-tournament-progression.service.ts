import { randomUUID } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";

import { AppError } from "../../errors";
import {
  BracketNodeInput,
  BracketSlotInput,
  PostgresTournamentProgressionRepository,
  PublishBracketInput,
  TournamentEngineTransactionManager,
  TournamentProgressionRecord
} from "../../tournament-engine/persistence";
import {
  BracketResolutionPlan,
  EffectiveSeedPlan,
  GlobalQualifierSeedCalculation,
  applyEffectiveSeedPermutationOverride,
  generateMirroredBracketTopology,
  MirroredBracketTopology,
  resolveBracketAdvancements,
  SINGLE_ELIMINATION_BRACKET_RULES_VERSION
} from "../../tournament-engine";
import {
  isStableUuid,
  parseStableUuid
} from "../../tournament-engine/domain";
import {
  EnginePersistenceConflictError,
  EnginePersistenceInvariantError,
  EngineWriterLeaseConflictError
} from "../../tournament-engine/persistence";
import { createUuidV5 } from "../../tournament-engine/scheduling/uuid-v5";
import {
  CANONICAL_WORKBOOK_SCHEMA_VERSION,
  CanonicalWorkbookGenerationInput,
  CanonicalWorkbookMatchInput,
  CanonicalWorkbookSheetManifestEntry,
  canonicalSha256,
  digestWorkbookParticipants,
  digestWorkbookValue,
  GeneratedWorkbookSheetInput,
  generateCanonicalTournamentWorkbook,
  PostgresWorkbookReconciliationRepository,
  selectCumulativePlayoffWorkbookMatches,
  WorkbookGenerationSourceRecord,
  WorkbookGenerationSourceTeamRecord
} from "../../tournament-engine/workbook";
import { AdministratorPrincipal } from "../security";
import {
  ApplyAdminMatchResolutionRequest,
  FinalizeAdminPodRequest,
  OverrideAdminSeedOrderRequest,
  PreviewAdminBracketRequest,
  PreviewAdminMatchResolutionRequest,
  PublishAdminBracketRequest,
  ResolveAdminGlobalSeedTieRequest,
  ResolveAdminStandingTieRequest
} from "./admin-tournament-progression.contracts";
import {
  parseGlobalSeedTieResolution,
  parseBracketPreview,
  parseBracketPublication,
  parseMatchResolutionApply,
  parseMatchResolutionPreview,
  parsePodFinalization,
  parsePodTieResolution,
  parseSeedOverride
} from "./admin-tournament-progression.validator";
import { prepareBracketCorrectionPlan } from "./admin-bracket-correction.plan";

const WRITER_LEASE_MILLISECONDS = 5 * 60 * 1_000;

@Injectable()
export class AdminTournamentProgressionService {
  constructor(
    private readonly repository: PostgresTournamentProgressionRepository,
    private readonly workbooks: PostgresWorkbookReconciliationRepository,
    private readonly transactions: TournamentEngineTransactionManager
  ) {}

  async get(tournamentIdValue: string): Promise<TournamentProgressionRecord> {
    const tournamentId = tournamentIdOf(tournamentIdValue);
    const progression = await this.repository.readProgression(tournamentId);
    if (progression === null) notFound();
    return progression;
  }

  async previewMatchResolution(
    tournamentIdValue: string,
    matchIdValue: string,
    request: PreviewAdminMatchResolutionRequest | null | undefined
  ) {
    const command = parseMatchResolutionPreview(request);
    try {
      const preview = await this.repository.previewOperatorMatchResolution({
        tournamentId: tournamentIdOf(tournamentIdValue),
        matchId: matchIdOf(matchIdValue),
        expectedTournamentRowVersion: command.expectedTournamentRowVersion,
        expectedMatchRowVersion: command.expectedMatchRowVersion,
        commandType: command.commandType,
        reason: command.reason,
        ...(command.winnerTeamId === undefined
          ? {}
          : { winnerTeamId: teamIdOf(command.winnerTeamId) })
      });
      if (!preview.requiresCascade) {
        return preview;
      }
      const [progression, source] = await Promise.all([
        this.get(tournamentIdValue),
        this.workbooks.readGenerationSource(tournamentIdOf(tournamentIdValue))
      ]);
      if (source === null) staleConfirmation();
      const cascade = prepareBracketCorrectionPlan({
        progression,
        source,
        correctedMatchId: matchIdOf(matchIdValue),
        ...(preview.proposedWinnerTeamId === undefined
          ? {
              correctedWinnerTeamId: null,
              correctedNoWinnerStatus: noWinnerStatus(preview.proposedStatus)
            }
          : { correctedWinnerTeamId: preview.proposedWinnerTeamId }),
        reason: command.reason
      });
      return {
        ...preview,
        cascadeImpact: {
          confirmationDigest: cascade.impact.confirmationDigest,
          actionCount: cascade.impact.actions.length,
          replacementCount: cascade.replacements.length,
          actions: cascade.impact.actions.map((action) => ({
            bracketMatchId: action.bracketMatchId,
            action: action.action,
            previousMatchId: action.preservedMatchId,
            replacementMatchId: action.replacement?.matchId ?? null
          }))
        }
      };
    } catch (error) {
      throw mapProgressionError(error);
    }
  }

  async applyMatchResolution(
    tournamentIdValue: string,
    matchIdValue: string,
    request: ApplyAdminMatchResolutionRequest | null | undefined,
    principal: AdministratorPrincipal
  ) {
    const command = parseMatchResolutionApply(request);
    const preview = await this.previewMatchResolution(
      tournamentIdValue,
      matchIdValue,
      command
    );
    if (preview.confirmationDigest !== command.confirmationDigest) {
      staleConfirmation();
    }
    const cascade = preview.requiresCascade
      ? await this.prepareConfirmedCascade(
        tournamentIdValue,
        matchIdValue,
        preview.proposedWinnerTeamId,
        preview.proposedStatus,
        command.reason,
        command.cascadeConfirmationDigest
      )
      : undefined;
    const matchId = matchIdOf(matchIdValue);
    const occurredAt = new Date().toISOString();
    const revisionId = parseStableUuid(createUuidV5(
      matchId,
      `operator-resolution|${command.commandType}|${command.confirmationDigest}`
    ), "match_revision");
    try {
      const operatorInput = {
        commandId: randomUUID(),
        tournamentId: tournamentIdOf(tournamentIdValue),
        matchId,
        expectedTournamentRowVersion: command.expectedTournamentRowVersion,
        expectedMatchRowVersion: command.expectedMatchRowVersion,
        commandType: command.commandType,
        ...(command.winnerTeamId === undefined
          ? {}
          : { winnerTeamId: teamIdOf(command.winnerTeamId) }),
        reason: command.reason,
        revisionId,
        revisionPublicKey: revisionId,
        eventId: createUuidV5(revisionId, `event|${command.commandType}`),
        rulesVersion: 1,
        confirmationDigest: command.confirmationDigest,
        actorId: principal.administratorId,
        occurredAt,
        writerLeaseExpiresAt: new Date(
          Date.parse(occurredAt) + WRITER_LEASE_MILLISECONDS
        ).toISOString()
      };
      return cascade === undefined
        ? await this.repository.recordOperatorMatchResolution(operatorInput)
        : await this.repository.recordOperatorMatchResolutionWithCascade({
          ...operatorInput,
          previousResolutionId: cascade.previousResolutionId,
          ...(preview.proposedWinnerTeamId === undefined ? {} : {
            correctedResolutionId: createUuidV5(
              matchId,
              `cascade-resolution|${command.confirmationDigest}`
            ),
            correctedAdvancementId: createUuidV5(
              matchId,
              `cascade-advancement|${command.confirmationDigest}`
            )
          }),
          cascadeConfirmationDigest: cascade.impact.confirmationDigest,
          replacements: cascade.replacements
        });
    } catch (error) {
      throw mapProgressionError(error);
    }
  }

  private async prepareConfirmedCascade(
    tournamentIdValue: string,
    matchIdValue: string,
    winnerTeamId: string | undefined,
    proposedStatus: "forfeited" | "cancelled" | "postponed",
    reason: string,
    confirmationDigest: string | undefined
  ) {
    const [progression, source] = await Promise.all([
      this.get(tournamentIdValue),
      this.workbooks.readGenerationSource(tournamentIdOf(tournamentIdValue))
    ]);
    if (source === null) staleConfirmation();
    const prepared = prepareBracketCorrectionPlan({
      progression,
      source,
      correctedMatchId: matchIdOf(matchIdValue),
      ...(winnerTeamId === undefined
        ? {
            correctedWinnerTeamId: null,
            correctedNoWinnerStatus: noWinnerStatus(proposedStatus)
          }
        : { correctedWinnerTeamId: teamIdOf(winnerTeamId) }),
      reason
    });
    if (prepared.impact.confirmationDigest !== confirmationDigest) {
      staleConfirmation();
    }
    return prepared;
  }

  async previewPodTieResolution(
    tournamentIdValue: string,
    podIdValue: string,
    request: Omit<ResolveAdminStandingTieRequest, "confirmationDigest">
  ) {
    const progression = await this.get(tournamentIdValue);
    const pod = requirePod(progression, podIdValue);
    const orderedTeamIds = rawUuidList(request.orderedTeamIds);
    const activeCalculationId = rawUuid(request.activeCalculationId);
    const tieGroupId = rawDigest(request.tieGroupId);
    const reason = rawReason(request.reason);
    const expectedTournamentRowVersion = rawVersion(
      request.expectedTournamentRowVersion
    );
    requireCurrentVersion(progression, expectedTournamentRowVersion);
    const tie = pod.tieGroups.find((item) => item.tieGroupId === tieGroupId);
    if (pod.activeCalculationId !== activeCalculationId || tie === undefined ||
        tie.resolved || !sameSet(orderedTeamIds, tie.teamIds)) {
      staleConfirmation();
    }
    return {
      confirmationDigest: progressionDigest("pod-standing-tie-v1", {
        tournamentId: progression.tournamentId,
        podId: pod.podId,
        tournamentRowVersion: progression.rowVersion,
        activeCalculationId,
        tieGroupId,
        orderedTeamIds,
        reason
      })
    };
  }

  async resolvePodTie(
    tournamentIdValue: string,
    podIdValue: string,
    request: ResolveAdminStandingTieRequest | null | undefined,
    principal: AdministratorPrincipal
  ) {
    const command = parsePodTieResolution(request);
    const preview = await this.previewPodTieResolution(
      tournamentIdValue,
      podIdValue,
      command
    );
    if (preview.confirmationDigest !== command.confirmationDigest) {
      staleConfirmation();
    }
    const tournamentId = tournamentIdOf(tournamentIdValue);
    const podId = podIdOf(podIdValue);
    try {
      return await this.repository.resolvePodTie({
        commandId: randomUUID(),
        replacementCalculationId: createUuidV5(
          command.activeCalculationId,
          `tie-resolution|${command.confirmationDigest}`
        ),
        tournamentId,
        podId,
        expectedTournamentRowVersion: command.expectedTournamentRowVersion,
        activeCalculationId: command.activeCalculationId,
        tieGroupId: command.tieGroupId,
        orderedTeamIds: command.orderedTeamIds.map(teamIdOf),
        reason: command.reason,
        confirmationDigest: command.confirmationDigest,
        administratorId: principal.administratorId,
        occurredAt: new Date().toISOString()
      });
    } catch (error) {
      throw mapProgressionError(error);
    }
  }

  async previewPodFinalization(
    tournamentIdValue: string,
    podIdValue: string,
    request: Omit<FinalizeAdminPodRequest, "confirmationDigest">
  ) {
    const progression = await this.get(tournamentIdValue);
    const pod = requirePod(progression, podIdValue);
    const expectedTournamentRowVersion = rawVersion(
      request.expectedTournamentRowVersion
    );
    const calculationId = rawUuid(request.calculationId);
    requireCurrentVersion(progression, expectedTournamentRowVersion);
    if (pod.activeCalculationId !== calculationId ||
        pod.calculationStatus !== "finalizable") {
      throw new AppError({
        code: "CONFLICT",
        message: "The pod is not ready for finalization.",
        statusCode: HttpStatus.CONFLICT,
        details: [{ code: "POD_NOT_FINALIZABLE", message: "Resolve every required match and tie first." }]
      });
    }
    return {
      confirmationDigest: progressionDigest("pod-finalization-v1", {
        tournamentId: progression.tournamentId,
        podId: pod.podId,
        tournamentRowVersion: progression.rowVersion,
        calculationId,
        reason: rawOptionalReason(request.reason)
      })
    };
  }

  async finalizePod(
    tournamentIdValue: string,
    podIdValue: string,
    request: FinalizeAdminPodRequest | null | undefined,
    principal: AdministratorPrincipal
  ) {
    const command = parsePodFinalization(request);
    const preview = await this.previewPodFinalization(
      tournamentIdValue,
      podIdValue,
      command
    );
    if (preview.confirmationDigest !== command.confirmationDigest) {
      staleConfirmation();
    }
    try {
      return await this.repository.finalizePod({
        tournamentId: tournamentIdOf(tournamentIdValue),
        podId: podIdOf(podIdValue),
        expectedTournamentRowVersion: command.expectedTournamentRowVersion,
        calculationId: command.calculationId,
        finalizationId: createUuidV5(
          command.calculationId,
          `finalization|${command.confirmationDigest}`
        ),
        ...(command.reason === undefined ? {} : { reason: command.reason }),
        confirmationDigest: command.confirmationDigest,
        administratorId: principal.administratorId,
        occurredAt: new Date().toISOString()
      });
    } catch (error) {
      throw mapProgressionError(error);
    }
  }

  async resolveGlobalSeedTie(
    tournamentIdValue: string,
    request: ResolveAdminGlobalSeedTieRequest | null | undefined,
    principal: AdministratorPrincipal
  ) {
    const command = parseGlobalSeedTieResolution(request);
    const preview = await this.previewGlobalSeedTie(
      tournamentIdValue,
      command
    );
    if (preview.confirmationDigest !== command.confirmationDigest) {
      staleConfirmation();
    }
    try {
      return await this.repository.resolveGlobalSeedTie({
        commandId: randomUUID(),
        reviewVersionId: createUuidV5(
          command.seedCalculationId,
          `review|${command.confirmationDigest}`
        ),
        tournamentId: tournamentIdOf(tournamentIdValue),
        expectedTournamentRowVersion: command.expectedTournamentRowVersion,
        activeReviewVersionId: command.activeReviewVersionId,
        seedCalculationId: command.seedCalculationId,
        tieGroupId: command.tieGroupId,
        orderedTeamIds: command.orderedTeamIds.map(teamIdOf),
        reason: command.reason,
        confirmationDigest: command.confirmationDigest,
        administratorId: principal.administratorId,
        occurredAt: new Date().toISOString()
      });
    } catch (error) {
      throw mapProgressionError(error);
    }
  }

  async previewGlobalSeedTie(
    tournamentIdValue: string,
    request: Omit<ResolveAdminGlobalSeedTieRequest, "confirmationDigest">
  ) {
    const progression = await this.get(tournamentIdValue);
    const expectedTournamentRowVersion = rawVersion(
      request.expectedTournamentRowVersion
    );
    const reviewVersionId = rawUuid(request.activeReviewVersionId);
    const seedCalculationId = rawUuid(request.seedCalculationId);
    const tieGroupId = rawUuid(request.tieGroupId);
    const orderedTeamIds = rawUuidList(request.orderedTeamIds);
    const reason = rawReason(request.reason);
    requireCurrentVersion(progression, expectedTournamentRowVersion);
    const review = progression.activeGlobalSeedReview;
    const tie = review?.tieGroups.find((item) => item.tieGroupId === tieGroupId);
    if (review === undefined || review.reviewVersionId !== reviewVersionId ||
        review.seedCalculationId !== seedCalculationId || tie === undefined ||
        tie.resolved || !sameSet(orderedTeamIds, tie.teamIds)) {
      staleConfirmation();
    }
    return {
      confirmationDigest: progressionDigest("global-seed-tie-v1", {
        tournamentId: progression.tournamentId,
        tournamentRowVersion: progression.rowVersion,
        reviewVersionId,
        seedCalculationId,
        tieGroupId,
        orderedTeamIds,
        reason
      })
    };
  }

  async previewSeedOverride(
    tournamentIdValue: string,
    request: Omit<OverrideAdminSeedOrderRequest, "confirmationDigest">
  ) {
    const progression = await this.get(tournamentIdValue);
    const expectedTournamentRowVersion = rawVersion(
      request.expectedTournamentRowVersion
    );
    const calculationId = rawUuid(request.calculationId);
    const orderedTeamIds = rawUuidList(request.orderedTeamIds);
    const reason = rawReason(request.reason);
    requireCurrentVersion(progression, expectedTournamentRowVersion);
    if (progression.activeSeedCalculationId !== calculationId ||
        !sameSet(orderedTeamIds, progression.effectiveSeeds.map((row) => row.teamId))) {
      staleConfirmation();
    }
    return {
      confirmationDigest: progressionDigest("effective-seed-permutation-v1", {
        tournamentId: progression.tournamentId,
        tournamentRowVersion: progression.rowVersion,
        calculationId,
        orderedTeamIds,
        reason
      })
    };
  }

  async overrideSeeds(
    tournamentIdValue: string,
    request: OverrideAdminSeedOrderRequest | null | undefined,
    principal: AdministratorPrincipal
  ) {
    const command = parseSeedOverride(request);
    const progression = await this.get(tournamentIdValue);
    const preview = await this.previewSeedOverride(tournamentIdValue, command);
    if (preview.confirmationDigest !== command.confirmationDigest) {
      staleConfirmation();
    }
    const currentByTeam = new Map(
      progression.effectiveSeeds.map((row) => [row.teamId, row])
    );
    const commandId = randomUUID();
    const occurredAt = new Date().toISOString();
    const overridePlan = applyEffectiveSeedPermutationOverride({
      calculation: completeSeedCalculation(progression),
      orderedTeamIds: command.orderedTeamIds.map(teamIdOf),
      audit: {
        overrideId: commandId,
        reason: command.reason,
        overriddenBy: principal.administratorId,
        overriddenAt: occurredAt
      }
    });
    try {
      return await this.repository.applySeedOverridePermutation({
        commandId,
        tournamentId: tournamentIdOf(tournamentIdValue),
        expectedTournamentRowVersion: command.expectedTournamentRowVersion,
        calculationId: command.calculationId,
        reason: command.reason,
        overrideDigest: overridePlan.overrideDigest ?? staleConfirmation(),
        rows: command.orderedTeamIds.map((teamId, index) => {
          const current = currentByTeam.get(teamIdOf(teamId));
          if (current === undefined) staleConfirmation();
          return {
            teamId: teamIdOf(teamId),
            previousSeed: current.effectiveSeed,
            newSeed: index + 1,
            ...(current.effectiveSeed === index + 1
              ? {}
              : { overrideId: randomUUID() })
          };
        }),
        confirmationDigest: command.confirmationDigest,
        administratorId: principal.administratorId,
        occurredAt
      });
    } catch (error) {
      throw mapProgressionError(error);
    }
  }

  async previewBracket(
    tournamentIdValue: string,
    request: PreviewAdminBracketRequest | null | undefined
  ) {
    const parsed = parseBracketPreview(request);
    const prepared = await this.prepareBracket(
      tournamentIdValue,
      parsed.expectedTournamentRowVersion
    );
    return prepared.preview;
  }

  async publishBracket(
    tournamentIdValue: string,
    request: PublishAdminBracketRequest | null | undefined,
    principal: AdministratorPrincipal
  ) {
    const parsed = parseBracketPublication(request);
    const prepared = await this.prepareBracket(
      tournamentIdValue,
      parsed.expectedTournamentRowVersion
    );
    if (prepared.preview.confirmationDigest !== parsed.confirmationDigest) {
      staleConfirmation();
    }
    const workbookId = createUuidV5(
      prepared.topology.bracketId,
      `publication-workbook|${parsed.confirmationDigest}`
    );
    const publicationId = createUuidV5(
      prepared.topology.bracketId,
      `publication|${parsed.confirmationDigest}`
    );
    const generatedAt = new Date().toISOString();
    const generationInput = bracketWorkbookInput(
      prepared.source,
      prepared.resolution,
      workbookId,
      prepared.sourceDigest,
      generatedAt
    );
    let generated: Awaited<ReturnType<typeof generateCanonicalTournamentWorkbook>>;
    try {
      generated = await generateCanonicalTournamentWorkbook(generationInput);
      const storedSheets = bracketWorkbookSheets(
        generated.manifest,
        generationInput,
        prepared.source,
        workbookId
      );
      return await this.transactions.run(async (transaction) => {
        const stored = await this.workbooks.storeGeneratedWorkbookInTransaction({
          workbookId,
          tournamentId: prepared.progression.tournamentId,
          generationRevision: prepared.source.nextGenerationRevision,
          workbookSchemaVersion: CANONICAL_WORKBOOK_SCHEMA_VERSION,
          generationKind: "playoffs_cumulative",
          sourceTournamentRowVersion: prepared.progression.rowVersion,
          sourceDigest: prepared.sourceDigest,
          artifact: generated.buffer,
          artifactDigest: generated.sha256,
          filename: bracketWorkbookFilename(prepared.source),
          generatedByAdminId: principal.administratorId,
          generatedAt,
          sheets: storedSheets,
          audit: { eventId: randomUUID() }
        }, transaction);
        const publication = await this.repository.publishBracketInTransaction(
          bracketPublicationInput(
            prepared,
            stored.workbook.workbookId,
            publicationId,
            parsed.confirmationDigest,
            principal,
            generatedAt
          ),
          transaction
        );
        return {
          ...publication,
          workbook: {
            id: stored.workbook.workbookId,
            revision: stored.workbook.generationRevision,
            sha256: stored.workbook.artifactDigest,
            filename: stored.workbook.filename,
            downloadUrl: `/api/admin/tournaments/${prepared.progression.tournamentId}/workbooks/${stored.workbook.workbookId}/download`
          }
        };
      });
    } catch (error) {
      throw mapProgressionError(error);
    }
  }

  private async prepareBracket(
    tournamentIdValue: string,
    expectedTournamentRowVersion: number
  ) {
    const tournamentId = tournamentIdOf(tournamentIdValue);
    const [progression, source] = await Promise.all([
      this.get(tournamentIdValue),
      this.workbooks.readGenerationSource(tournamentId)
    ]);
    if (source === null) notFound();
    requireCurrentVersion(progression, expectedTournamentRowVersion);
    if (progression.lifecycle !== "seeding_review" ||
        progression.activeBracket !== undefined ||
        progression.activeSeedCalculationId === undefined ||
        progression.activeGlobalSeedReview?.status !== "complete" ||
        progression.activeGlobalSeedReview.seedCalculationId !==
          progression.activeSeedCalculationId ||
        progression.pods.some((pod) => pod.activeFinalizationId === undefined)) {
      throw new AppError({
        code: "CONFLICT",
        message: "Tournament is not ready for bracket publication.",
        statusCode: HttpStatus.CONFLICT,
        details: [{
          code: "BRACKET_NOT_READY",
          message: "Finalize every pod and resolve global seeding before publication."
        }]
      });
    }
    const seedPlan = effectiveSeedPlan(progression);
    const topology = generateMirroredBracketTopology({
      tournamentId,
      rulesVersion: SINGLE_ELIMINATION_BRACKET_RULES_VERSION,
      bracketSize: progression.bracketSize,
      allowByes: source.configuration.allowByes,
      effectiveSeedPlan: seedPlan
    });
    const resolution = resolveBracketAdvancements({
      topology,
      activeMatches: []
    });
    const sourceDigest = canonicalSha256({
      contract: "bracket-publication-workbook-source-v1",
      tournamentRowVersion: progression.rowVersion,
      workbookSource: generationSourceDigest(source),
      topologyDigest: topology.topologyDigest,
      resolutionDigest: resolution.resolutionDigest
    });
    const confirmationDigest = progressionDigest("bracket-publication-v1", {
      tournamentId,
      tournamentRowVersion: progression.rowVersion,
      activeSeedCalculationId: progression.activeSeedCalculationId,
      activeSeedOverrideCommandId:
        progression.activeSeedOverrideCommandId ?? null,
      topologyDigest: topology.topologyDigest,
      resolutionDigest: resolution.resolutionDigest,
      sourceDigest
    });
    return {
      progression,
      source,
      topology,
      resolution,
      sourceDigest,
      preview: {
        tournamentId,
        tournamentRowVersion: progression.rowVersion,
        seedCalculationId: progression.activeSeedCalculationId,
        bracketId: topology.bracketId,
        topologyDigest: topology.topologyDigest,
        confirmationDigest,
        bracketSize: topology.bracketSize,
        qualifierCount: topology.qualifierCount,
        roundCount: topology.rounds.length,
        playableMatchCount: resolution.playableMatches.length,
        byeCount: resolution.rounds.flatMap((round) => round.matches)
          .filter((match) => match.state === "automatic_advance").length,
        placementOrder: topology.placementOrder
      }
    };
  }
}

function completeSeedCalculation(
  progression: TournamentProgressionRecord
): GlobalQualifierSeedCalculation {
  const review = progression.activeGlobalSeedReview;
  if (review === undefined || review.status !== "complete") staleConfirmation();
  const calculatedByTeam = new Map(
    progression.effectiveSeeds.map((seed) => [seed.teamId, seed.calculatedSeed])
  );
  const rows = progression.pods.flatMap((pod) =>
    pod.rows.filter((row) => row.qualified).map((row) => {
      const calculatedSeed = calculatedByTeam.get(row.teamId);
      if (calculatedSeed === undefined || row.rank === null) staleConfirmation();
      return {
        teamId: row.teamId,
        podId: pod.podId,
        podRank: row.rank,
        wins: row.wins,
        losses: row.losses,
        cupDifferential: row.cupDifferential,
        makes: row.makes ?? 0,
        attempts: row.attempts ?? 0,
        shootingPercentage: row.shootingPercentage,
        calculatedSeed,
        seedRange: [calculatedSeed, calculatedSeed] as const
      };
    })
  );
  return {
    tournamentId: progression.tournamentId,
    seedCalculationId: review.seedCalculationId,
    rulesVersion: review.rulesVersion,
    inputDigest: review.inputDigest,
    status: "complete",
    rows,
    tieGroups: []
  };
}

function effectiveSeedPlan(
  progression: TournamentProgressionRecord
): EffectiveSeedPlan {
  const review = progression.activeGlobalSeedReview;
  const calculationId = progression.activeSeedCalculationId;
  if (review === undefined || calculationId === undefined ||
      review.seedCalculationId !== calculationId ||
      progression.effectiveSeeds.length === 0) {
    staleConfirmation();
  }
  const podByTeam = new Map<string, ReturnType<typeof podIdOf>>();
  for (const pod of progression.pods) {
    for (const row of pod.rows.filter((candidate) => candidate.qualified)) {
      if (podByTeam.has(row.teamId)) staleConfirmation();
      podByTeam.set(row.teamId, pod.podId);
    }
  }
  const rows = progression.effectiveSeeds.map((seed) => {
    const podId = podByTeam.get(seed.teamId);
    if (podId === undefined) staleConfirmation();
    return {
      teamId: seed.teamId,
      podId,
      calculatedSeed: seed.calculatedSeed,
      effectiveSeed: seed.effectiveSeed
    };
  });
  const override = progression.activeSeedOverride;
  if (override === undefined) {
    return {
      tournamentId: progression.tournamentId,
      seedCalculationId: calculationId,
      seedCalculationInputDigest: review.inputDigest,
      source: "calculated",
      overrideDigest: null,
      audit: null,
      rows,
      changes: []
    };
  }
  return {
    tournamentId: progression.tournamentId,
    seedCalculationId: calculationId,
    seedCalculationInputDigest: review.inputDigest,
    source: "administrator_override",
    overrideDigest: override.overrideDigest,
    audit: {
      overrideId: override.commandId,
      reason: override.reason,
      overriddenBy: override.administratorId,
      overriddenAt: override.occurredAt
    },
    rows,
    changes: rows.filter((row) => row.calculatedSeed !== row.effectiveSeed)
      .map((row) => ({
        teamId: row.teamId,
        previousSeed: row.calculatedSeed,
        newSeed: row.effectiveSeed
      }))
  };
}

function bracketWorkbookInput(
  source: WorkbookGenerationSourceRecord,
  resolution: BracketResolutionPlan,
  workbookId: string,
  sourceDigest: string,
  generatedAt: string
): CanonicalWorkbookGenerationInput {
  const existingMatches = source.matches.flatMap<CanonicalWorkbookMatchInput>(
    (match) => {
      const mapped = sourceWorkbookMatch(match);
      return mapped === null ? [] : [mapped];
    }
  );
  const firstSequence = existingMatches.reduce(
    (maximum, match) => Math.max(maximum, match.sequence),
    0
  ) + 1;
  const playoffs = selectCumulativePlayoffWorkbookMatches({
    resolution,
    firstSequence
  }).map((match) => ({
    ...match,
    participantRosters: [
      generationRosterForTeam(source, match.participantTeamIds[0]),
      generationRosterForTeam(source, match.participantTeamIds[1])
    ] as const
  }));
  return {
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
    teams: source.teams.map(generationTeam),
    matches: [...existingMatches, ...playoffs]
  };
}

function sourceWorkbookMatch(
  match: WorkbookGenerationSourceRecord["matches"][number]
): CanonicalWorkbookMatchInput | null {
  if (match.activeScorecardSource === null &&
      (match.status !== "scheduled" || match.workbookState !== null)) {
    return null;
  }
  const common = {
    id: parseStableUuid(match.matchId, "match"),
    sequence: match.sequence,
    roundNumber: match.roundNumber,
    participantTeamIds: [
      parseStableUuid(match.participantTeamIds[0], "tournament_team"),
      parseStableUuid(match.participantTeamIds[1], "tournament_team")
    ] as const,
    participantRosters: [
      generationRosterFromMatch(match.participantTeams[0]),
      generationRosterFromMatch(match.participantTeams[1])
    ] as const,
    ...(match.activeScorecardSource === null
      ? {}
      : { scorecardSource: match.activeScorecardSource })
  };
  return match.stage === "pod_play"
    ? {
        ...common,
        stage: "pod_play",
        podId: parseStableUuid(match.podId, "pod"),
        sequenceInPod: match.sequenceInPod,
        gameNumberForPair: match.gameNumberForPair
      }
    : {
        ...common,
        stage: "playoffs",
        bracketMatchId: parseStableUuid(match.bracketMatchId, "bracket_match"),
        sequenceInRound: match.sequenceInRound
      };
}

function generationTeam(team: WorkbookGenerationSourceTeamRecord) {
  return {
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
  };
}

function generationRosterForTeam(
  source: WorkbookGenerationSourceRecord,
  teamId: string
) {
  const team = source.teams.find((candidate) => candidate.teamId === teamId);
  if (team === undefined) staleConfirmation();
  return {
    teamId: parseStableUuid(team.teamId, "tournament_team"),
    players: generationTeam(team).players
  };
}

function generationRosterFromMatch(
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

function bracketWorkbookSheets(
  manifest: readonly CanonicalWorkbookSheetManifestEntry[],
  generation: CanonicalWorkbookGenerationInput,
  source: WorkbookGenerationSourceRecord,
  workbookId: string
): readonly GeneratedWorkbookSheetInput[] {
  return manifest.flatMap<GeneratedWorkbookSheetInput>((sheet) => {
    if (sheet.sheetKind === "metadata") return [];
    const sheetId = createUuidV5(
      workbookId,
      `sheet|${sheet.sheetKind === "game" ? sheet.matchId : sheet.sheetKind}`
    );
    if (sheet.sheetKind === "control") {
      return [{
        sheetId,
        sheetOrdinal: sheet.order,
        sheetKind: "control",
        sheetName: sheet.sheetName,
        baselineFingerprint: null
      }];
    }
    if (sheet.sheetKind === "blank") {
      return [{
        sheetId,
        sheetOrdinal: sheet.order,
        sheetKind: "blank",
        sheetName: sheet.sheetName,
        baselineFingerprint: sheet.baselineFingerprint
      }];
    }
    if (sheet.matchId === null || sheet.baselineFingerprint === null) {
      staleConfirmation();
    }
    const match = generation.matches.find((candidate) =>
      candidate.id === sheet.matchId
    );
    if (match === undefined) staleConfirmation();
    const sourceMatch = source.matches.find((candidate) =>
      candidate.matchId === sheet.matchId
    );
    const participantTeams = match.participantTeamIds.map((teamId, index) => {
      const team = source.teams.find((candidate) => candidate.teamId === teamId);
      const roster = match.participantRosters?.[index];
      if (team === undefined || roster === undefined) staleConfirmation();
      return {
        sideNumber: (index + 1) as 1 | 2,
        teamId,
        displayName: team.name,
        players: roster.players.map((player) => ({
          playerId: player.id,
          rosterMembershipId: player.rosterMembershipId,
          rosterSlot: player.rosterSlot,
          displayName: player.displayName
        }))
      };
    });
    return [{
      sheetId,
      sheetOrdinal: sheet.order,
      sheetKind: "game",
      sheetName: sheet.sheetName,
      matchId: sheet.matchId,
      generatedMatchRowVersion: sourceMatch?.rowVersion ?? 1,
      participantTeamIds: match.participantTeamIds,
      participantDigest: digestWorkbookParticipants(participantTeams),
      baselineFingerprint: sheet.baselineFingerprint
    }];
  });
}

function bracketPublicationInput(
  prepared: {
    progression: TournamentProgressionRecord;
    source: WorkbookGenerationSourceRecord;
    topology: MirroredBracketTopology;
    resolution: BracketResolutionPlan;
  },
  workbookId: string,
  publicationId: string,
  confirmationDigest: string,
  principal: AdministratorPrincipal,
  occurredAt: string
): PublishBracketInput {
  const resolvedById = new Map(
    prepared.resolution.rounds.flatMap((round) => round.matches)
      .map((match) => [match.id, match])
  );
  const firstSequence = prepared.source.matches.reduce(
    (maximum, match) => Math.max(maximum, match.sequence),
    0
  ) + 1;
  return {
    publicationId,
    tournamentId: prepared.progression.tournamentId,
    expectedTournamentRowVersion: prepared.progression.rowVersion,
    seedCalculationId: prepared.topology.seedCalculationId,
    ...(prepared.progression.activeSeedOverrideCommandId === undefined
      ? {}
      : {
          seedOverrideCommandId:
            prepared.progression.activeSeedOverrideCommandId
        }),
    cumulativeWorkbookId: workbookId,
    confirmationDigest,
    administratorId: principal.administratorId,
    occurredAt,
    bracket: {
      id: prepared.topology.bracketId,
      publicKey: `bracket-${prepared.topology.bracketId}`,
      name: `${prepared.source.tournament.name} Playoffs`,
      bracketSize: prepared.topology.bracketSize,
      metadata: {
        topologyDigest: prepared.topology.topologyDigest,
        resolutionDigest: prepared.resolution.resolutionDigest,
        rulesVersion: prepared.topology.rulesVersion
      },
      rounds: prepared.topology.rounds.map((round) => ({
        id: round.id,
        publicKey: `round-${round.roundNumber}`,
        name: round.name,
        sequence: round.roundNumber,
        metadata: { roundNumber: round.roundNumber },
        matches: round.matches.map((node) => {
          const resolved = resolvedById.get(node.id);
          if (resolved === undefined) staleConfirmation();
          const slots = resolved.slots.map(bracketSlot) as [
            BracketSlotInput,
            BracketSlotInput
          ];
          const match = resolved.matchInstance;
          const bracketNode: BracketNodeInput = {
            id: node.id,
            publicKey: `bracket-match-${round.roundNumber}-${node.position}`,
            sequence: node.position,
            playable: match !== null,
            slots,
            metadata: {
              roundNumber: round.roundNumber,
              sequenceInRound: node.position,
              topologySequence: node.sequence,
              initialResolutionState: resolved.state
            },
            ...(match === null ? {} : {
              match: {
                id: match.matchId,
                publicKey: `playoff-match-${match.matchId}`,
                sequence: firstSequence + node.sequence - 1,
                slots,
                metadata: {
                  bracketMatchId: node.id,
                  roundNumber: round.roundNumber,
                  sequenceInRound: node.position,
                  instanceNumber: match.instanceNumber
                }
              }
            })
          };
          return bracketNode;
        })
      }))
    },
    metadata: {
      topologyDigest: prepared.topology.topologyDigest,
      resolutionDigest: prepared.resolution.resolutionDigest
    }
  };
}

function bracketSlot(
  slot: BracketResolutionPlan["rounds"][number]["matches"][number]["slots"][number]
): BracketSlotInput {
  const sourceType = slot.source.type === "winner"
    ? "match_winner" as const
    : slot.state.type === "team" ? "team" as const : "bye" as const;
  return {
    id: slot.id,
    publicKey: `bracket-slot-${slot.id}`,
    slotNumber: slot.slotNumber,
    sourceType,
    ...(slot.state.type === "team" ? { teamId: slot.state.teamId } : {}),
    ...(slot.source.type === "winner"
      ? { sourceBracketMatchId: slot.source.bracketMatchId }
      : { seed: slot.source.seed }),
    metadata: { state: slot.state.type }
  };
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

function bracketWorkbookFilename(source: WorkbookGenerationSourceRecord): string {
  const slug = source.tournament.name.normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80) || "tournament";
  return `ruski-report-${source.tournament.year}-${slug}-playoffs-r${source.nextGenerationRevision}.xlsx`;
}

function tournamentIdOf(value: string) {
  return parseStableUuid(value, "tournament");
}

function matchIdOf(value: string) {
  return parseStableUuid(value, "match");
}

function podIdOf(value: string) {
  return parseStableUuid(value, "pod");
}

function teamIdOf(value: string) {
  return parseStableUuid(value, "tournament_team");
}

function requirePod(progression: TournamentProgressionRecord, value: string) {
  const podId = podIdOf(value);
  const pod = progression.pods.find((item) => item.podId === podId);
  if (pod === undefined) notFound();
  return pod;
}

function requireCurrentVersion(
  progression: TournamentProgressionRecord,
  expected: number
): void {
  if (progression.rowVersion !== expected) staleConfirmation();
}

function progressionDigest(contract: string, value: unknown): string {
  return digestWorkbookValue({ contract, value });
}

function rawVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalidPreview();
  return Number(value);
}

function rawUuid(value: unknown): string {
  if (typeof value !== "string" || !isStableUuid(value)) invalidPreview();
  return value.toLowerCase();
}

function rawDigest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    invalidPreview();
  }
  return value;
}

function rawUuidList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 ||
      value.some((item) => typeof item !== "string" || !isStableUuid(item)) ||
      new Set(value.map((item) => String(item).toLowerCase())).size !== value.length) {
    invalidPreview();
  }
  return value.map((item) => String(item).toLowerCase());
}

function rawReason(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 3 ||
      value.trim().length > 500) invalidPreview();
  return value.trim();
}

function rawOptionalReason(value: unknown): string | undefined {
  return value === undefined || value === null || value === ""
    ? undefined
    : rawReason(value);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((value) => right.includes(value));
}

function mapProgressionError(error: unknown): unknown {
  if (error instanceof EngineWriterLeaseConflictError ||
      error instanceof EnginePersistenceConflictError) {
    return new AppError({
      code: "CONFLICT",
      message: "Tournament progression changed before the command was applied.",
      statusCode: HttpStatus.CONFLICT,
      details: [{ code: "PROGRESSION_CONFLICT", message: error.message }]
    });
  }
  if (error instanceof EnginePersistenceInvariantError) {
    return new AppError({
      code: "VALIDATION_FAILED",
      message: "Tournament progression command is invalid.",
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      details: [{ code: "PROGRESSION_INVARIANT", message: error.message }]
    });
  }
  return error;
}

function invalidPreview(): never {
  throw new AppError({
    code: "VALIDATION_FAILED",
    message: "Tournament progression preview request is invalid.",
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY
  });
}

function noWinnerStatus(
  status: "forfeited" | "cancelled" | "postponed"
): "cancelled" | "postponed" {
  if (status === "cancelled" || status === "postponed") return status;
  return staleConfirmation();
}

function staleConfirmation(): never {
  throw new AppError({
    code: "CONFLICT",
    message: "Tournament progression changed after preview.",
    statusCode: HttpStatus.CONFLICT,
    details: [{ code: "STALE_PROGRESSION_CONFIRMATION", message: "Preview the command again." }]
  });
}

function notFound(): never {
  throw new AppError({
    code: "NOT_FOUND",
    message: "Tournament progression was not found.",
    statusCode: HttpStatus.NOT_FOUND
  });
}
