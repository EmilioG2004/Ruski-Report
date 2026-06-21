import {
  BoxScore,
  GameDefinition,
  GameEvent
} from "../domain";
import {
  GamePlugin,
  GamePluginRegistry,
  ParsedScorebook,
  ScorebookFile,
  TournamentSnapshot,
  ValidationResult,
  validationFailed,
  validationPassed
} from "../games";
import {
  InMemoryTournamentSnapshotRepository,
  InMemoryTransactionManager,
  InMemoryUploadReportRepository,
  repositoryFailure,
  RepositoryResult,
  TournamentSnapshotRepository,
  PublishSnapshotResult,
  UploadReport
} from "../repositories";
import {
  ruskiGameDefinition,
  sampleMatchDetail,
  sampleTournament
} from "../sample-data";
import {
  AdminScorebookService,
  UploadedScorebookFile
} from "./admin-scorebook.service";

const xlsxMime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("AdminScorebookService", () => {
  it("parses, validates, normalizes, publishes, and records an upload report", async () => {
    const parsed = createParsedScorebook();
    const snapshot = createSnapshot(parsed);
    const plugin = createPlugin({
      parsed,
      snapshot
    });
    const uploadReports = new InMemoryUploadReportRepository();
    const snapshots = new InMemoryTournamentSnapshotRepository();
    const service = createService(plugin, uploadReports, snapshots);

    const response = await service.uploadScorebook({
      year: 2026,
      gameType: "ruski",
      file: createFile()
    });

    expect(response).toMatchObject({
      gameType: "ruski",
      status: "published",
      tournamentId: "tournament-2026",
      snapshotVersion: {
        tournamentId: "tournament-2026",
        gameType: "ruski",
        version: sampleTournament.version
      }
    });
    expect(plugin.parseScorebook).toHaveBeenCalledWith(
      expect.objectContaining({
        originalName: "scorebook.xlsx",
        mimeType: xlsxMime,
        metadata: expect.objectContaining({
          year: 2026,
          uploadId: response.uploadId
        })
      })
    );
    expect(snapshots.getLatestSnapshot("tournament-2026")).toBe(snapshot);

    const reportLookup = await uploadReports.findById(response.uploadId);
    expect(reportLookup.ok && reportLookup.value).toMatchObject({
      id: response.uploadId,
      status: "published",
      tournamentId: "tournament-2026"
    });
  });

  it("returns a validation report and does not publish invalid scorebooks", async () => {
    const parsed = createParsedScorebook();
    const validation = validationFailed([
      {
        code: "MISSING_GAME_SHEET",
        message: "Scorebook does not contain game sheets.",
        severity: "error",
        path: "sheets"
      }
    ]);
    const plugin = createPlugin({
      parsed,
      validation
    });
    const uploadReports = new InMemoryUploadReportRepository();
    const snapshots = new InMemoryTournamentSnapshotRepository();
    const service = createService(plugin, uploadReports, snapshots);

    const response = await service.uploadScorebook({
      year: 2026,
      gameType: "ruski",
      file: createFile()
    });

    expect(response.status).toBe("validation_failed");
    expect(response.validation.errors).toEqual(validation.errors);
    expect(plugin.normalizeScorebook).not.toHaveBeenCalled();
    expect(snapshots.getLatestSnapshot("tournament-2026")).toBeNull();

    const reportLookup = await uploadReports.findById(response.uploadId);
    expect(reportLookup.ok && reportLookup.value?.status).toBe(
      "validation_failed"
    );
  });

  it("rejects unsupported game types before creating an upload report", async () => {
    const uploadReports = new InMemoryUploadReportRepository();
    const service = new AdminScorebookService(
      new GamePluginRegistry([]),
      uploadReports,
      new InMemoryTournamentSnapshotRepository(),
      new InMemoryTransactionManager()
    );

    await expect(
      service.uploadScorebook({
        year: 2026,
        gameType: "unknown",
        file: createFile()
      })
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_GAME_TYPE"
    });
  });

  it("marks the upload report as publish failed when snapshot storage fails", async () => {
    const parsed = createParsedScorebook();
    const snapshot = createSnapshot(parsed);
    const plugin = createPlugin({
      parsed,
      snapshot
    });
    const uploadReports = new RecordingUploadReportRepository();
    const service = createService(
      plugin,
      uploadReports,
      new FailingSnapshotRepository()
    );

    await expect(
      service.uploadScorebook({
        year: 2026,
        gameType: "ruski",
        file: createFile()
      })
    ).rejects.toMatchObject({
      code: "PERSISTENCE_ERROR"
    });

    expect(uploadReports.latestReport()).toMatchObject({
      status: "publish_failed",
      tournamentId: "tournament-2026"
    });
  });
});

class RecordingUploadReportRepository extends InMemoryUploadReportRepository {
  private latest?: UploadReport;

  override async update(
    ...args: Parameters<InMemoryUploadReportRepository["update"]>
  ): ReturnType<InMemoryUploadReportRepository["update"]> {
    const result = await super.update(...args);

    if (result.ok) {
      this.latest = result.value;
    }

    return result;
  }

  latestReport() {
    return this.latest;
  }
}

class FailingSnapshotRepository implements TournamentSnapshotRepository {
  async publishSnapshot(): Promise<RepositoryResult<PublishSnapshotResult>> {
    return repositoryFailure({
      code: "storage_failed",
      message: "Snapshot storage is unavailable."
    });
  }
}

function createService(
  plugin: jest.Mocked<GamePlugin>,
  uploadReports = new InMemoryUploadReportRepository(),
  snapshots: TournamentSnapshotRepository =
    new InMemoryTournamentSnapshotRepository()
): AdminScorebookService {
  return new AdminScorebookService(
    new GamePluginRegistry([plugin]),
    uploadReports,
    snapshots,
    new InMemoryTransactionManager()
  );
}

function createPlugin(input: {
  parsed: ParsedScorebook;
  snapshot?: TournamentSnapshot;
  validation?: ValidationResult;
}): jest.Mocked<GamePlugin> {
  const validation = input.validation ?? validationPassed();
  const snapshot = input.snapshot ?? createSnapshot(input.parsed);
  const boxScore: BoxScore = {
    matchId: "match-2026-001",
    gameType: "ruski",
    rows: []
  };

  return {
    gameType: "ruski",
    loadDefinition: jest.fn<GameDefinition, []>().mockReturnValue(
      ruskiGameDefinition
    ),
    parseScorebook: jest
      .fn<Promise<ParsedScorebook>, [ScorebookFile]>()
      .mockResolvedValue(input.parsed),
    validateScorebook: jest
      .fn<ReturnType<GamePlugin["validateScorebook"]>, [ParsedScorebook]>()
      .mockReturnValue(validation),
    normalizeScorebook: jest
      .fn<Promise<TournamentSnapshot>, [ParsedScorebook]>()
      .mockResolvedValue(snapshot),
    calculateStats: jest
      .fn<BoxScore, [GameEvent[]]>()
      .mockReturnValue(boxScore)
  };
}

function createParsedScorebook(): ParsedScorebook {
  return {
    gameType: "ruski",
    source: {
      originalName: "scorebook.xlsx",
      mimeType: xlsxMime,
      sizeBytes: 4,
      checksum: "checksum",
      metadata: {
        year: 2026
      }
    },
    sheets: [
      {
        name: "Game 1",
        index: 0,
        role: "game"
      }
    ]
  };
}

function createSnapshot(parsed: ParsedScorebook): TournamentSnapshot {
  return {
    tournament: sampleTournament,
    matches: [sampleMatchDetail],
    gameDefinition: ruskiGameDefinition,
    source: parsed.source,
    validation: validationPassed(),
    generatedAt: "2026-06-21T12:00:00.000Z"
  };
}

function createFile(): UploadedScorebookFile {
  return {
    buffer: Buffer.from("xlsx"),
    originalname: "scorebook.xlsx",
    mimetype: xlsxMime,
    size: 4
  };
}
