import { loadDatabaseConfig } from "../../config/database.config";
import { PostgresDatabase } from "../../database";
import { MigrationRunner } from "../../database/migration-runner";
import { PostgresTransactionManager } from "../../database/postgres-transaction.manager";
import {
  TournamentSnapshot,
  validationFailed,
  validationPassed
} from "../../games";
import {
  ruskiGameDefinition,
  sampleMatchDetail,
  sampleTournament
} from "../../sample-data";
import { PostgresCommentRepository } from "./postgres-comment.repository";
import { PostgresTournamentReadRepository } from "./postgres-tournament-read.repository";
import { PostgresTournamentSnapshotRepository } from "./postgres-tournament-snapshot.repository";
import { PostgresUploadReportRepository } from "./postgres-upload-report.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const postgresDescribe = testDatabaseUrl === undefined ? describe.skip : describe;

postgresDescribe("PostgreSQL persistence", () => {
  let database: PostgresDatabase;
  let transactions: PostgresTransactionManager;
  let snapshots: PostgresTournamentSnapshotRepository;
  let reads: PostgresTournamentReadRepository;
  let comments: PostgresCommentRepository;
  let uploadReports: PostgresUploadReportRepository;

  beforeAll(async () => {
    const config = loadDatabaseConfig({
      DATABASE_URL: testDatabaseUrl,
      DATABASE_MIGRATIONS_DIR: `${process.cwd()}/migrations`
    });
    database = new PostgresDatabase(config);
    await new MigrationRunner(database, config).migrate();
    transactions = new PostgresTransactionManager(database);
    snapshots = new PostgresTournamentSnapshotRepository(database);
    reads = new PostgresTournamentReadRepository(database);
    comments = new PostgresCommentRepository(database);
    uploadReports = new PostgresUploadReportRepository(database);
  });

  beforeEach(async () => {
    await database.query("TRUNCATE tournaments, scorebook_sources CASCADE");
  });

  afterAll(async () => {
    await database.onApplicationShutdown();
  });

  it("publishes and reads a complete active tournament snapshot", async () => {
    const published = await publishSnapshot(createSnapshot("upload-read"));

    const active = await reads.findActiveTournament({ gameType: "ruski" });
    const tournament = await reads.findTournamentById(sampleTournament.id);
    const matches = await reads.findMatchesByTournamentId(sampleTournament.id);
    const match = await reads.findMatchDetail(sampleMatchDetail.id);

    expect(published.snapshotVersion?.version).toBe(3);
    expect(active.ok && active.value).toMatchObject({
      id: sampleTournament.id,
      version: 3
    });
    expect(tournament.ok && tournament.value).toMatchObject({
      id: sampleTournament.id,
      teams: sampleTournament.teams,
      pods: sampleTournament.pods,
      standings: sampleTournament.standings
    });
    expect(matches.ok && matches.value).toHaveLength(1);
    expect(match.ok && match.value).toMatchObject({
      id: sampleMatchDetail.id,
      scorecard: sampleMatchDetail.scorecard,
      events: sampleMatchDetail.events
    });
  });

  it("keeps the previous active snapshot visible after rollback", async () => {
    await publishSnapshot(createSnapshot("upload-initial"));
    const replacement = createSnapshot("upload-rollback", 4, "Replacement");

    await expect(
      transactions.runInTransaction(async (transaction) => {
        const result = await snapshots.publishSnapshot(replacement, transaction);
        if (!result.ok) {
          throw new Error(result.error.message);
        }
        throw new Error("Force rollback after snapshot write.");
      })
    ).rejects.toThrow("Force rollback");

    const tournament = await reads.findTournamentById(sampleTournament.id);
    expect(tournament.ok && tournament.value).toMatchObject({
      name: sampleTournament.name,
      version: 3
    });
  });

  it("preserves comments when a new snapshot becomes active", async () => {
    await publishSnapshot(createSnapshot("upload-comments-1"));
    const created = await comments.create({
      matchId: sampleMatchDetail.id,
      author: {
        kind: "account",
        displayName: "Score Watcher",
        userId: "user-1"
      },
      body: "Great match."
    });

    await publishSnapshot(createSnapshot("upload-comments-2", 4));
    const stored = await comments.findByMatchId(sampleMatchDetail.id);

    expect(created.ok).toBe(true);
    expect(stored.ok && stored.value).toMatchObject([
      {
        matchId: sampleMatchDetail.id,
        body: "Great match."
      }
    ]);
  });

  it("stores failed and published upload reports", async () => {
    const failedReport = {
      id: "upload-failed",
      gameType: "ruski",
      source: { originalName: "bad.xlsx" },
      status: "validation_failed" as const,
      validation: validationFailed([
        {
          code: "MISSING_TAB",
          message: "Required tab is missing.",
          severity: "error" as const
        }
      ]),
      receivedAt: "2026-06-17T10:00:00.000Z",
      completedAt: "2026-06-17T10:00:01.000Z"
    };
    await uploadReports.create(failedReport);

    const receivedReport = {
      id: "upload-published",
      gameType: "ruski",
      source: { originalName: "good.xlsx" },
      status: "received" as const,
      validation: validationPassed(),
      receivedAt: "2026-06-17T11:00:00.000Z"
    };
    await uploadReports.create(receivedReport);
    await transactions.runInTransaction(async (transaction) => {
      const publishResult = await snapshots.publishSnapshot(
        createSnapshot(receivedReport.id),
        transaction
      );
      if (!publishResult.ok || publishResult.value.snapshotVersion === undefined) {
        throw new Error("Expected snapshot publication to succeed.");
      }

      const updateResult = await uploadReports.update(
        {
          ...receivedReport,
          status: "published",
          tournamentId: sampleTournament.id,
          snapshotVersion: publishResult.value.snapshotVersion,
          completedAt: "2026-06-17T11:00:01.000Z"
        },
        transaction
      );
      if (!updateResult.ok) {
        throw new Error(updateResult.error.message);
      }
    });

    const failed = await uploadReports.findById(failedReport.id);
    const published = await uploadReports.findById(receivedReport.id);
    expect(failed.ok && failed.value?.status).toBe("validation_failed");
    expect(published.ok && published.value).toMatchObject({
      status: "published",
      tournamentId: sampleTournament.id,
      snapshotVersion: { version: 3 }
    });
  });

  async function publishSnapshot(snapshot: TournamentSnapshot) {
    return transactions.runInTransaction(async (transaction) => {
      const result = await snapshots.publishSnapshot(snapshot, transaction);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.value;
    });
  }
});

function createSnapshot(
  uploadId: string,
  version = sampleTournament.version,
  name = sampleTournament.name
): TournamentSnapshot {
  return {
    tournament: {
      ...structuredClone(sampleTournament),
      name,
      version
    },
    matches: [structuredClone(sampleMatchDetail)],
    gameDefinition: structuredClone(ruskiGameDefinition),
    source: {
      originalName: "scorebook.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 1024,
      checksum: `checksum-${uploadId}`,
      metadata: { uploadId }
    },
    validation: validationPassed(),
    generatedAt: "2026-06-17T12:00:00.000Z"
  };
}
