import { AppError } from "../../errors";
import {
  PostgresTournamentProgressionRepository,
  TournamentEngineTransactionManager,
  TournamentProgressionRecord
} from "../../tournament-engine/persistence";
import {
  PostgresWorkbookReconciliationRepository,
  StoreGeneratedWorkbookInput,
  WorkbookGenerationSourceRecord
} from "../../tournament-engine/workbook";
import { AdministratorPrincipal } from "../security";
import * as bracketCorrectionPlan from "./admin-bracket-correction.plan";
import { AdminTournamentProgressionService } from "./admin-tournament-progression.service";

describe("AdminTournamentProgressionService", () => {
  afterEach(() => jest.restoreAllMocks());

  it("previews and atomically publishes a bracket with its cumulative workbook", async () => {
    const calls: string[] = [];
    const progression = progressionFixture();
    const source = sourceFixture();
    const repository = {
      readProgression: jest.fn().mockResolvedValue(progression),
      publishBracketInTransaction: jest.fn().mockImplementation((input) => {
        calls.push("publish");
        return Promise.resolve({
          tournamentId: input.tournamentId,
          bracketId: input.bracket.id,
          publicationId: input.publicationId,
          lifecycle: "playoffs",
          tournamentRowVersion: 8,
          playableMatchIds: input.bracket.rounds.flatMap((round: {
            matches: Array<{ match?: { id: string } }>;
          }) => round.matches.flatMap((match) =>
            match.match === undefined ? [] : [match.match.id]
          ))
        });
      })
    } as unknown as PostgresTournamentProgressionRepository;
    const workbooks = {
      readGenerationSource: jest.fn().mockResolvedValue(source),
      storeGeneratedWorkbookInTransaction: jest.fn().mockImplementation(
        (input: StoreGeneratedWorkbookInput) => {
          calls.push("workbook");
          return Promise.resolve({
            created: true,
            workbook: {
              workbookId: input.workbookId,
              tournamentId: input.tournamentId,
              generationRevision: input.generationRevision,
              workbookSchemaVersion: input.workbookSchemaVersion,
              generationKind: input.generationKind,
              sourceTournamentRowVersion: input.sourceTournamentRowVersion,
              sourceDigest: input.sourceDigest,
              artifactDigest: input.artifactDigest,
              artifactSizeBytes: input.artifact.byteLength,
              artifact: input.artifact,
              filename: input.filename,
              generatedByAdminId: input.generatedByAdminId,
              generatedAt: input.generatedAt,
              sheets: []
            }
          });
        }
      )
    } as unknown as PostgresWorkbookReconciliationRepository;
    const transactions = {
      run: jest.fn().mockImplementation(async (operation) =>
        operation({ context: { id: uuid(99) } }))
    } as unknown as TournamentEngineTransactionManager;
    const service = new AdminTournamentProgressionService(
      repository,
      workbooks,
      transactions
    );

    const preview = await service.previewBracket(TOURNAMENT_ID, {
      expectedTournamentRowVersion: 7
    });
    const result = await service.publishBracket(TOURNAMENT_ID, {
      expectedTournamentRowVersion: 7,
      confirmationDigest: preview.confirmationDigest
    }, PRINCIPAL);

    expect(preview).toMatchObject({
      bracketSize: 2,
      qualifierCount: 2,
      roundCount: 1,
      playableMatchCount: 1,
      byeCount: 0
    });
    expect(calls).toEqual(["workbook", "publish"]);
    expect(workbooks.storeGeneratedWorkbookInTransaction)
      .toHaveBeenCalledWith(expect.objectContaining({
        generationKind: "playoffs_cumulative",
        sourceTournamentRowVersion: 7,
        generatedByAdminId: PRINCIPAL.administratorId,
        sheets: expect.arrayContaining([
          expect.objectContaining({ sheetKind: "game" })
        ])
      }), expect.any(Object));
    expect(repository.publishBracketInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedTournamentRowVersion: 7,
        cumulativeWorkbookId: expect.any(String),
        bracket: expect.objectContaining({ bracketSize: 2 })
      }),
      expect.any(Object)
    );
    expect(result).toMatchObject({
      lifecycle: "playoffs",
      workbook: { downloadUrl: expect.stringContaining("/workbooks/") }
    });
  });

  it("rejects a stale bracket confirmation before opening a write transaction", async () => {
    const repository = {
      readProgression: jest.fn().mockResolvedValue(progressionFixture())
    } as unknown as PostgresTournamentProgressionRepository;
    const workbooks = {
      readGenerationSource: jest.fn().mockResolvedValue(sourceFixture())
    } as unknown as PostgresWorkbookReconciliationRepository;
    const transactions = {
      run: jest.fn()
    } as unknown as TournamentEngineTransactionManager;
    const service = new AdminTournamentProgressionService(
      repository,
      workbooks,
      transactions
    );

    await expect(service.publishBracket(TOURNAMENT_ID, {
      expectedTournamentRowVersion: 7,
      confirmationDigest: "f".repeat(64)
    }, PRINCIPAL)).rejects.toBeInstanceOf(AppError);
    expect(transactions.run).not.toHaveBeenCalled();
  });

  it("previews only unresolved exact tie permutations", async () => {
    const progression = progressionFixture();
    const tieGroupId = "b".repeat(64);
    const tied = {
      ...progression,
      pods: progression.pods.map((pod, index) => index === 0 ? {
        ...pod,
        tieGroups: [{
          tieGroupId,
          teamIds: [TEAM_ONE_ID as never, TEAM_TWO_ID as never],
          resolved: false
        }]
      } : pod)
    };
    const readProgression = jest.fn().mockResolvedValue(tied);
    const repository = {
      readProgression
    } as unknown as PostgresTournamentProgressionRepository;
    const service = new AdminTournamentProgressionService(
      repository,
      {} as PostgresWorkbookReconciliationRepository,
      {} as TournamentEngineTransactionManager
    );
    const pod = tied.pods[0];
    if (pod?.activeCalculationId === undefined) throw new Error("Pod fixture is missing.");
    const request = {
      expectedTournamentRowVersion: tied.rowVersion,
      activeCalculationId: pod.activeCalculationId,
      tieGroupId,
      orderedTeamIds: [TEAM_TWO_ID, TEAM_ONE_ID],
      reason: "Resolve exact standing tie."
    };

    await expect(service.previewPodTieResolution(
      TOURNAMENT_ID,
      pod.podId,
      request
    )).resolves.toMatchObject({
      confirmationDigest: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    await expect(service.previewPodTieResolution(
      TOURNAMENT_ID,
      pod.podId,
      { ...request, orderedTeamIds: [TEAM_ONE_ID] }
    )).rejects.toBeInstanceOf(AppError);
    readProgression.mockResolvedValue({
      ...tied,
      pods: tied.pods.map((item, index) => index === 0 ? {
        ...item,
        tieGroups: item.tieGroups.map((tie) => ({ ...tie, resolved: true }))
      } : item)
    });
    await expect(service.previewPodTieResolution(
      TOURNAMENT_ID,
      pod.podId,
      request
    )).rejects.toBeInstanceOf(AppError);
  });

  it("rejects malformed and already-resolved global seed tie previews", async () => {
    const progression = progressionFixture();
    const tieGroupId = uuid(90);
    const review = progression.activeGlobalSeedReview;
    if (review === undefined) throw new Error("Seed review fixture is missing.");
    const readProgression = jest.fn().mockResolvedValue({
      ...progression,
      activeGlobalSeedReview: {
        ...review,
        status: "unresolved_tie",
        tieGroups: [{
          tieGroupId,
          teamIds: [TEAM_ONE_ID as never, TEAM_TWO_ID as never],
          resolved: false
        }]
      }
    });
    const service = new AdminTournamentProgressionService(
      { readProgression } as unknown as PostgresTournamentProgressionRepository,
      {} as PostgresWorkbookReconciliationRepository,
      {} as TournamentEngineTransactionManager
    );
    const request = {
      expectedTournamentRowVersion: progression.rowVersion,
      activeReviewVersionId: review.reviewVersionId,
      seedCalculationId: review.seedCalculationId,
      tieGroupId,
      orderedTeamIds: [TEAM_TWO_ID, TEAM_ONE_ID],
      reason: "Resolve exact seed tie."
    };

    await expect(service.previewGlobalSeedTie(TOURNAMENT_ID, request))
      .resolves.toMatchObject({ confirmationDigest: expect.any(String) });
    await expect(service.previewGlobalSeedTie(TOURNAMENT_ID, {
      ...request,
      orderedTeamIds: [TEAM_ONE_ID, TEAM_ONE_ID]
    })).rejects.toBeInstanceOf(AppError);
    readProgression.mockResolvedValue({
      ...progression,
      activeGlobalSeedReview: {
        ...review,
        tieGroups: [{
          tieGroupId,
          teamIds: [TEAM_ONE_ID as never, TEAM_TWO_ID as never],
          resolved: true
        }]
      }
    });
    await expect(service.previewGlobalSeedTie(TOURNAMENT_ID, request))
      .rejects.toBeInstanceOf(AppError);
  });

  it("confirms a no-winner cascade without inventing a replacement resolution", async () => {
    const matchId = uuid(91);
    const bracketMatchId = uuid(92);
    const cascadeDigest = "d".repeat(64);
    const ordinaryDigest = "e".repeat(64);
    jest.spyOn(bracketCorrectionPlan, "prepareBracketCorrectionPlan")
      .mockReturnValue({
        previousResolutionId: uuid(93),
        impact: {
          correctedBracketMatchId: bracketMatchId,
          correctedWinnerTeamId: null,
          correctedNoWinnerStatus: "cancelled",
          confirmationDigest: cascadeDigest,
          requiresConfirmation: true,
          actions: [{
            bracketMatchId: uuid(94),
            action: "supersede_started_match_until_resolved",
            preservedMatchId: uuid(95),
            replacement: { matchId: uuid(96) }
          }]
        },
        replacements: [{
          replacementId: uuid(97),
          bracketMatchId: uuid(94) as never,
          previousMatchId: uuid(95) as never,
          reason: "Cancel corrected source",
          createWhenPlayable: true,
          pendingMatch: {
            id: uuid(96) as never,
            publicKey: uuid(96),
            sequence: 4,
            metadata: { instanceNumber: 2 }
          }
        }]
      } as never);
    const preview = {
      tournamentId: TOURNAMENT_ID as never,
      matchId: matchId as never,
      currentStatus: "final" as const,
      proposedStatus: "cancelled" as const,
      bracketMatchId: bracketMatchId as never,
      dependentBracketMatchIds: [uuid(94) as never],
      requiresCascade: true,
      confirmationDigest: ordinaryDigest
    };
    const applyCascade = jest.fn().mockResolvedValue({
      replacementMatchIds: [uuid(96)]
    });
    const repository = {
      readProgression: jest.fn().mockResolvedValue(progressionFixture()),
      previewOperatorMatchResolution: jest.fn().mockResolvedValue(preview),
      recordOperatorMatchResolutionWithCascade: applyCascade
    } as unknown as PostgresTournamentProgressionRepository;
    const service = new AdminTournamentProgressionService(
      repository,
      {
        readGenerationSource: jest.fn().mockResolvedValue(sourceFixture())
      } as unknown as PostgresWorkbookReconciliationRepository,
      {} as TournamentEngineTransactionManager
    );
    const request = {
      expectedTournamentRowVersion: 7,
      expectedMatchRowVersion: 2,
      commandType: "cancel" as const,
      reason: "Cancel corrected playoff result"
    };

    await expect(service.previewMatchResolution(
      TOURNAMENT_ID,
      matchId,
      request
    )).resolves.toMatchObject({
      cascadeImpact: { confirmationDigest: cascadeDigest }
    });
    await service.applyMatchResolution(TOURNAMENT_ID, matchId, {
      ...request,
      confirmationDigest: ordinaryDigest,
      cascadeConfirmationDigest: cascadeDigest
    }, PRINCIPAL);

    const command = applyCascade.mock.calls[0]?.[0];
    expect(command).toMatchObject({
      commandType: "cancel",
      cascadeConfirmationDigest: cascadeDigest,
      previousResolutionId: uuid(93)
    });
    expect(command).not.toHaveProperty("winnerTeamId");
    expect(command).not.toHaveProperty("correctedResolutionId");
    expect(command).not.toHaveProperty("correctedAdvancementId");
  });
});

function progressionFixture(): TournamentProgressionRecord {
  return {
    tournamentId: TOURNAMENT_ID as never,
    lifecycle: "seeding_review",
    rowVersion: 7,
    qualifiersPerPod: 1,
    bracketSize: 2,
    pods: [pod(1, TEAM_ONE_ID), pod(2, TEAM_TWO_ID)],
    activeGlobalSeedReview: {
      reviewVersionId: uuid(30),
      seedCalculationId: SEED_CALCULATION_ID,
      inputDigest: "a".repeat(64),
      rulesVersion: 1,
      status: "complete",
      tieGroups: []
    },
    activeSeedCalculationId: SEED_CALCULATION_ID,
    effectiveSeeds: [
      { teamId: TEAM_ONE_ID as never, calculatedSeed: 1, effectiveSeed: 1 },
      { teamId: TEAM_TWO_ID as never, calculatedSeed: 2, effectiveSeed: 2 }
    ]
  };
}

function pod(sequence: number, teamId: string) {
  return {
    podId: uuid(10 + sequence) as never,
    publicKey: `pod-${sequence}`,
    name: `Pod ${sequence}`,
    sequence,
    activeCalculationId: uuid(20 + sequence),
    calculationStatus: "finalizable" as const,
    rows: [{
      teamId: teamId as never,
      teamName: `Team ${sequence}`,
      rank: 1,
      wins: 1,
      losses: 0,
      cupDifferential: sequence,
      makes: 1,
      attempts: 2,
      shootingPercentage: 0.5,
      qualified: true
    }],
    tieGroups: [],
    activeFinalizationId: uuid(40 + sequence),
    finalizedAt: "2027-01-01T00:00:00.000Z"
  };
}

function sourceFixture(): WorkbookGenerationSourceRecord {
  const podOneId = uuid(11);
  const podTwoId = uuid(12);
  return {
    nextGenerationRevision: 2,
    tournament: {
      tournamentId: TOURNAMENT_ID as never,
      publicKey: "phase-five",
      year: 2027,
      name: "Phase Five",
      lifecycle: "seeding_review",
      rowVersion: 7,
      setupPublishedAt: "2027-01-01T00:00:00.000Z"
    },
    configuration: {
      formatVersion: 1,
      formatType: "pod_and_single_elimination",
      teamCount: 2,
      podCount: 2,
      podSizes: [1, 1],
      playersPerTeam: 1,
      gamesPerPair: 1,
      qualifiersPerPod: 1,
      bracketSize: 2,
      allowByes: false,
      standingsRules: [
        "record",
        "cupDifferential",
        "teamShootingPercentage",
        "administratorResolution"
      ]
    },
    pods: [
      { podId: podOneId, name: "Pod 1", sequence: 1 },
      { podId: podTwoId, name: "Pod 2", sequence: 2 }
    ],
    teams: [
      team(TEAM_ONE_ID, podOneId, 1),
      team(TEAM_TWO_ID, podTwoId, 2)
    ],
    matches: []
  };
}

function team(
  teamId: string,
  podId: string,
  sequence: number
) {
  return {
    teamId,
    name: `Team ${sequence}`,
    sequence,
    podId,
    initialSeed: 1,
    players: [{
      playerId: uuid(50 + sequence),
      rosterMembershipId: uuid(60 + sequence),
      rosterSlot: 1,
      displayName: `Player ${sequence}`
    }]
  };
}

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

const TOURNAMENT_ID = uuid(1);
const TEAM_ONE_ID = uuid(2);
const TEAM_TWO_ID = uuid(3);
const SEED_CALCULATION_ID = uuid(4);
const PRINCIPAL: AdministratorPrincipal = {
  administratorId: uuid(5),
  loginName: "operator",
  displayName: "Operator",
  sessionId: uuid(6),
  authenticatedAt: "2027-01-01T00:00:00.000Z",
  expiresAt: "2027-01-02T00:00:00.000Z"
};
