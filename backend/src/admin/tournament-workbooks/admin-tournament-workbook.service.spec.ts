import { AppError } from "../../errors";
import { parseStableUuid } from "../../tournament-engine/domain";
import {
  digestWorkbookParticipants,
  digestWorkbookValue,
  PostgresWorkbookReconciliationRepository,
  StoreGeneratedWorkbookInput,
  WorkbookGenerationSourceRecord,
  WorkbookImportPreviewRecord,
  WorkbookRevisionCandidateInput
} from "../../tournament-engine/workbook";
import { AdministratorPrincipal } from "../security";
import { AdminTournamentWorkbookService } from "./admin-tournament-workbook.service";

const TOURNAMENT_ID = stable(1, "tournament");

describe("AdminTournamentWorkbookService", () => {
  it("generates and stores an exact canonical artifact from published state", async () => {
    const source = generationSource();
    let storedInput: StoreGeneratedWorkbookInput | undefined;
    const repository = {
      readGenerationSource: jest.fn().mockResolvedValue(source),
      storeGeneratedWorkbook: jest.fn().mockImplementation(
        (input: StoreGeneratedWorkbookInput) => {
          storedInput = input;
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
    const service = new AdminTournamentWorkbookService(repository);

    const response = await service.generate(
      TOURNAMENT_ID,
      { expectedTournamentRowVersion: 2 },
      PRINCIPAL
    );

    expect(storedInput).toBeDefined();
    expect(storedInput?.artifact.subarray(0, 2).toString()).toBe("PK");
    expect(storedInput?.artifactDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(storedInput?.sourceDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(storedInput?.sheets).toHaveLength(3);
    expect(storedInput?.sheets.map((sheet) => sheet.sheetKind))
      .toEqual(["control", "blank", "game"]);
    expect(storedInput?.sheets.every((sheet) =>
      /^[0-9a-f-]{36}$/u.test(sheet.sheetId)
    )).toBe(true);
    expect(response).toMatchObject({
      tournamentId: TOURNAMENT_ID,
      revision: 1,
      schemaVersion: 1,
      artifactSha256: storedInput?.artifactDigest
    });
    expect(response.downloadUrl).toBe(
      `/api/admin/tournaments/${TOURNAMENT_ID}/workbooks/${response.id}/download`
    );
  });

  it("rejects stale generation and unsafe upload types before persistence", async () => {
    const repository = {
      readGenerationSource: jest.fn().mockResolvedValue(generationSource()),
      createImportPreview: jest.fn()
    } as unknown as PostgresWorkbookReconciliationRepository;
    const service = new AdminTournamentWorkbookService(repository);

    await expect(service.generate(
      TOURNAMENT_ID,
      { expectedTournamentRowVersion: 1 },
      PRINCIPAL
    )).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
    await expect(service.preview(
      TOURNAMENT_ID,
      {
        buffer: Buffer.from("PK\u0003\u0004not-a-workbook"),
        originalname: "operator-private.xlsm",
        mimetype: "application/vnd.ms-excel.sheet.macroEnabled.12",
        size: 18
      },
      PRINCIPAL
    )).rejects.toBeInstanceOf(AppError);
    expect(repository.createImportPreview).not.toHaveBeenCalled();
  });

  it("maps a stored unsupported generation source to a stable validation error", async () => {
    const source = generationSource();
    const repository = {
      readGenerationSource: jest.fn().mockResolvedValue({
        ...source,
        matches: Array.from({ length: 258 }, () => source.matches[0])
      }),
      storeGeneratedWorkbook: jest.fn()
    } as unknown as PostgresWorkbookReconciliationRepository;
    const service = new AdminTournamentWorkbookService(repository);

    await expect(service.generate(
      TOURNAMENT_ID,
      { expectedTournamentRowVersion: 2 },
      PRINCIPAL
    )).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      statusCode: 422,
      details: [{ code: "WORKBOOK_GENERATION_UNSUPPORTED" }]
    });
    expect(repository.storeGeneratedWorkbook).not.toHaveBeenCalled();
  });

  it("reads v1 candidate envelopes and exposes canonical proposed impact", async () => {
    const source = generationSource();
    const candidate = revisionCandidate(source, 1);
    const batch = previewRecord(source, candidate);
    const repository = {
      findImportPreview: jest.fn().mockResolvedValue(batch),
      readGenerationSource: jest.fn().mockResolvedValue(source)
    } as unknown as PostgresWorkbookReconciliationRepository;
    const service = new AdminTournamentWorkbookService(repository);

    const response = await service.findPreview(TOURNAMENT_ID, batch.batchId);

    expect(response.observations[0]).toMatchObject({
      currentImpact: null,
      proposedImpact: {
        winnerTeamId: source.matches[0]?.participantTeamIds[0],
        matchTotals: { attempts: 1, makes: 1, cupsScored: 1 }
      }
    });
    expect(response.observations[0]?.proposedImpact?.teams.map((team) => team.score))
      .toEqual([1, 0]);
  });

  it("passes the planned confirmation digest and returns materialization results", async () => {
    const source = generationSource();
    const candidate = revisionCandidate(source, 2, 2);
    const batch = previewRecord(source, candidate);
    const confirmImport = jest.fn().mockResolvedValue({
      batchId: batch.batchId,
      tournamentId: TOURNAMENT_ID,
      status: "applied",
      appliedMatchIds: [candidate.matchId],
      skippedMatchIds: [],
      unchangedMatchIds: [],
      missingMatchIds: [],
      materializedRevisions: [{
        matchId: candidate.matchId,
        candidateId: candidate.candidateId,
        revisionId: stable(603, "match_revision"),
        matchStatisticRunId: stable(604, "match_revision"),
        matchRowVersion: 2
      }],
      tournamentStatisticRunId: stable(605, "match_revision"),
      tournamentStatisticRunDigest: "9".repeat(64),
      completedAt: "2026-08-20T13:00:00.000Z"
    });
    const repository = {
      findImportPreview: jest.fn().mockResolvedValue(batch),
      readGenerationSource: jest.fn().mockResolvedValue(source),
      confirmImport
    } as unknown as PostgresWorkbookReconciliationRepository;
    const service = new AdminTournamentWorkbookService(repository);

    const response = await service.apply(
      TOURNAMENT_ID,
      batch.batchId,
      {
        previewDigest: batch.previewDigest,
        acceptedObservationIds: [batch.observations[0]?.observationId],
        skippedObservationIds: [],
        correctionReasons: {}
      },
      PRINCIPAL
    );

    expect(confirmImport).toHaveBeenCalledWith(expect.objectContaining({
      previewDigest: batch.previewDigest,
      confirmationDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      acceptedObservationIds: [batch.observations[0]?.observationId]
    }));
    expect(response).toMatchObject({
      acceptedCount: 1,
      materializedRevisions: [{
        candidateId: candidate.candidateId,
        matchRowVersion: 2
      }],
      tournamentStatisticRunDigest: "9".repeat(64)
    });
  });
});

function generationSource(): WorkbookGenerationSourceRecord {
  const podId = stable(2, "pod");
  const firstTeamId = stable(3, "tournament_team");
  const secondTeamId = stable(4, "tournament_team");
  const firstTeam = team(3, firstTeamId, podId, "Red");
  const secondTeam = team(4, secondTeamId, podId, "Blue");
  return {
    nextGenerationRevision: 1,
    tournament: {
      tournamentId: TOURNAMENT_ID,
      publicKey: TOURNAMENT_ID,
      year: 2027,
      name: "Sanitized Main Event",
      lifecycle: "setup_published",
      rowVersion: 2,
      setupPublishedAt: "2026-08-20T12:00:00.000Z"
    },
    configuration: {
      formatVersion: 1,
      formatType: "pod_and_single_elimination",
      teamCount: 2,
      podCount: 1,
      podSizes: [2],
      playersPerTeam: 2,
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
    pods: [{ podId, name: "Pod 1", sequence: 1 }],
    teams: [firstTeam, secondTeam],
    matches: [{
      matchId: stable(20, "match"),
      stage: "pod_play",
      podId,
      sequence: 1,
      rowVersion: 1,
      status: "scheduled",
      scoreAvailability: "not_started",
      participantTeamIds: [firstTeamId, secondTeamId],
      participantTeams: [
        {
          sideNumber: 1,
          teamId: firstTeam.teamId,
          name: firstTeam.name,
          players: firstTeam.players
        },
        {
          sideNumber: 2,
          teamId: secondTeam.teamId,
          name: secondTeam.name,
          players: secondTeam.players
        }
      ],
      sequenceInPod: 1,
      roundNumber: 1,
      gameNumberForPair: 1,
      activeScoringPreview: null,
      workbookState: null
    }]
  };
}

function revisionCandidate(
  source: WorkbookGenerationSourceRecord,
  suffix: number,
  envelopeSchemaVersion: 1 | 2 = 1
): WorkbookRevisionCandidateInput {
  const match = source.matches[0];
  if (match === undefined) {
    throw new Error("Sanitized source requires a match.");
  }
  const teams = match.participantTeams.map((team) => ({
    sideNumber: team.sideNumber,
    teamId: team.teamId,
    displayName: team.name,
    players: team.players.map((player) => ({
      ...player,
      displayName: player.displayName
    }))
  }));
  const participantDigest = digestWorkbookParticipants(teams);
  const candidateId = `00000000-0000-4000-8000-${String(600 + suffix).padStart(12, "0")}`;
  const participants = teams.flatMap((team) => team.players.map((player) => ({
    sideNumber: team.sideNumber,
    teamId: team.teamId,
    playerId: player.playerId,
    rosterMembershipId: player.rosterMembershipId,
    rosterSlot: player.rosterSlot,
    displayNameAtImport: player.displayName
  })));
  const rows = ([1, 2] as const).flatMap((sideNumber) =>
    Array.from({ length: 80 }, (_, index) => {
      const team = teams[sideNumber - 1];
      const player = team?.players[index % 2];
      if (team === undefined || player === undefined) {
        throw new Error("Sanitized source participant is missing.");
      }
      return {
        sideNumber,
        worksheetRow: index + 10,
        shotNumber: Math.floor(index / 2) + 1,
        teamId: team.teamId,
        playerId: player.playerId,
        rosterMembershipId: player.rosterMembershipId,
        rosterSlot: player.rosterSlot,
        markers: {
          miss: false,
          make: sideNumber === 1 && index === 0,
          splashOut: false,
          guy: false,
          tri: false,
          di: false,
          vom: false
        }
      };
    })
  );
  const envelope = {
    contract: envelopeSchemaVersion === 1
      ? "workbook-match-revision-candidate-v1"
      : "workbook-match-revision-candidate-v2",
    semanticCandidateId: candidateId,
    tournamentId: source.tournament.tournamentId,
    matchId: match.matchId,
    sourceRevisionNumber: 1,
    previousCandidateId: null,
    fingerprint: "f".repeat(64),
    proposedStatus: "final",
    proposedScoreAvailability: "complete",
    reason: "initial",
    participantDigest,
    participants,
    rows,
    ...(envelopeSchemaVersion === 1 ? {} : {
      formulaSummaryObservations: [{
        sideNumber: 1,
        subjectType: "team",
        metric: "makes",
        formulaState: "changed",
        cachedValue: 999
      }]
    })
  };
  return {
    candidateId,
    matchId: match.matchId,
    sourceRevisionNumber: 1,
    fingerprint: "f".repeat(64),
    proposedStatus: "final",
    proposedScoreAvailability: "complete",
    reason: "initial",
    requiresConfirmation: false,
    expectedMatchRowVersion: match.rowVersion,
    expectedSourceStateVersion: 0,
    envelopeSchemaVersion,
    envelope,
    envelopeDigest: digestWorkbookValue(envelope),
    participantDigest,
    teams
  };
}

function previewRecord(
  source: WorkbookGenerationSourceRecord,
  candidate: WorkbookRevisionCandidateInput
): WorkbookImportPreviewRecord {
  const observationId = "00000000-0000-4000-8000-000000000703";
  return {
    batchId: "00000000-0000-4000-8000-000000000701",
    tournamentId: source.tournament.tournamentId,
    workbookId: "00000000-0000-4000-8000-000000000702",
    supersedesBatchId: null,
    workbookSchemaVersion: 1,
    sourceWorkbookDigest: "b".repeat(64),
    sourceSizeBytes: 1024,
    baseTournamentRowVersion: source.tournament.rowVersion,
    previewDigest: "c".repeat(64),
    status: "preview_ready",
    receivedByAdminId: PRINCIPAL.administratorId,
    receivedAt: "2026-08-20T12:00:00.000Z",
    previewedAt: "2026-08-20T12:01:00.000Z",
    previewExpiresAt: "2099-08-21T12:01:00.000Z",
    confirmedByAdminId: null,
    confirmedAt: null,
    completedAt: null,
    counts: { recognized: 1, proposed: 1, unchanged: 0, missing: 0, invalid: 0 },
    observations: [{
      observationId,
      observationKind: "present",
      sheetOrdinal: 3,
      workbookSheetId: null,
      matchId: candidate.matchId,
      assignmentSource: "stable_metadata",
      disposition: "proposed",
      fingerprint: candidate.fingerprint,
      baseMatchRowVersion: candidate.expectedMatchRowVersion,
      baseSourceStateVersion: candidate.expectedSourceStateVersion,
      sourceEnvelopeSchemaVersion: 1,
      sourceEnvelopeDigest: "d".repeat(64),
      sourceEnvelope: { sheet: { worksheetIndex: 2, worksheetName: "Game 1" } },
      validationIssues: [],
      candidate
    }]
  };
}

function team(
  seed: number,
  teamId: string,
  podId: string,
  name: string
) {
  return {
    teamId,
    name,
    sequence: seed - 2,
    podId,
    initialSeed: seed - 2,
    players: [1, 2].map((slot) => ({
      playerId: stable(seed * 10 + slot, "tournament_player"),
      rosterMembershipId: stable(seed * 10 + slot + 100, "roster_membership"),
      rosterSlot: slot,
      displayName: `${name} Player ${slot}`
    }))
  };
}

function stable<Kind extends Parameters<typeof parseStableUuid>[1]>(
  suffix: number,
  kind: Kind
) {
  return parseStableUuid(
    `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`,
    kind
  );
}

const PRINCIPAL: AdministratorPrincipal = {
  administratorId: stable(500, "tournament"),
  loginName: "operator",
  displayName: "Tournament Operator",
  sessionId: stable(501, "tournament"),
  authenticatedAt: "2026-08-20T12:00:00.000Z",
  expiresAt: "2026-08-20T20:00:00.000Z"
};
