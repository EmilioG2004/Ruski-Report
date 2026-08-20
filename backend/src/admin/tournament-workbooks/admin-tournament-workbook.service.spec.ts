import { AppError } from "../../errors";
import { parseStableUuid } from "../../tournament-engine/domain";
import {
  PostgresWorkbookReconciliationRepository,
  StoreGeneratedWorkbookInput,
  WorkbookGenerationSourceRecord
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
      workbookState: null
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
