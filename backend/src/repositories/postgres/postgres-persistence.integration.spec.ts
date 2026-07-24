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
import { PostgresCommentReportRepository } from "./postgres-comment-report.repository";
import { PostgresAccountRepository } from "./postgres-account.repository";
import { PostgresAuthSessionRepository } from "./postgres-auth-session.repository";
import { PostgresTournamentReadRepository } from "./postgres-tournament-read.repository";
import { PostgresTournamentSnapshotRepository } from "./postgres-tournament-snapshot.repository";
import { PostgresUploadReportRepository } from "./postgres-upload-report.repository";
import { PostgresUserBlockRepository } from "./postgres-user-block.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const postgresDescribe = testDatabaseUrl === undefined ? describe.skip : describe;

postgresDescribe("PostgreSQL persistence", () => {
  let database: PostgresDatabase;
  let transactions: PostgresTransactionManager;
  let snapshots: PostgresTournamentSnapshotRepository;
  let reads: PostgresTournamentReadRepository;
  let comments: PostgresCommentRepository;
  let commentReports: PostgresCommentReportRepository;
  let accounts: PostgresAccountRepository;
  let authSessions: PostgresAuthSessionRepository;
  let uploadReports: PostgresUploadReportRepository;
  let userBlocks: PostgresUserBlockRepository;

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
    commentReports = new PostgresCommentReportRepository(database);
    accounts = new PostgresAccountRepository(database);
    authSessions = new PostgresAuthSessionRepository(database);
    uploadReports = new PostgresUploadReportRepository(database);
    userBlocks = new PostgresUserBlockRepository(database);
  });

  beforeEach(async () => {
    await database.query(
      "TRUNCATE tournaments, scorebook_sources, user_accounts CASCADE"
    );
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
    const account = await accounts.createLocalAccount({
      displayName: "Score Watcher",
      normalizedDisplayName: "score watcher",
      passwordHash: "test-password-hash"
    });
    if (!account.ok) {
      throw new Error(account.error.message);
    }
    const created = await comments.create({
      matchId: sampleMatchDetail.id,
      author: {
        kind: "account",
        displayName: "Score Watcher",
        userId: account.value.id
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

  it("filters blocked comments for one session and preserves guest visibility", async () => {
    await publishSnapshot(createSnapshot("user-blocking"));
    const viewer = await accounts.createLocalAccount({
      displayName: "Viewer",
      normalizedDisplayName: "viewer",
      passwordHash: "viewer-password-hash"
    });
    const blocked = await accounts.createLocalAccount({
      displayName: "Blocked Player",
      normalizedDisplayName: "blocked player",
      passwordHash: "blocked-password-hash"
    });
    const visible = await accounts.createLocalAccount({
      displayName: "Visible Player",
      normalizedDisplayName: "visible player",
      passwordHash: "visible-password-hash"
    });
    if (!viewer.ok || !blocked.ok || !visible.ok) {
      throw new Error("Expected blocking test accounts to be created.");
    }

    await comments.create({
      matchId: sampleMatchDetail.id,
      author: {
        kind: "account",
        displayName: blocked.value.displayName,
        userId: blocked.value.id
      },
      body: "Hidden for the viewer."
    });
    await comments.create({
      matchId: sampleMatchDetail.id,
      author: {
        kind: "account",
        displayName: visible.value.displayName,
        userId: visible.value.id
      },
      body: "Visible for everyone."
    });

    const created = await transactions.runInTransaction((transaction) =>
      userBlocks.block(
        {
          blockerUserId: viewer.value.id,
          blockedUser: {
            userId: blocked.value.id,
            displayName: blocked.value.displayName
          },
          createdAt: "2026-07-23T12:00:00.000Z"
        },
        transaction
      )
    );
    const retried = await transactions.runInTransaction((transaction) =>
      userBlocks.block(
        {
          blockerUserId: viewer.value.id,
          blockedUser: {
            userId: blocked.value.id,
            displayName: blocked.value.displayName
          },
          createdAt: "2026-07-23T12:01:00.000Z"
        },
        transaction
      )
    );
    const guestComments = await comments.findByMatchId(sampleMatchDetail.id);
    const viewerComments = await comments.findByMatchId(
      sampleMatchDetail.id,
      viewer.value.id
    );

    expect(created.ok && created.value.status).toBe("created");
    expect(retried.ok && retried.value.status).toBe("existing");
    expect(guestComments.ok && guestComments.value).toHaveLength(2);
    expect(
      viewerComments.ok &&
        viewerComments.value.map((comment) => comment.body)
    ).toEqual(["Visible for everyone."]);

    await expect(
      userBlocks.unblock(viewer.value.id, blocked.value.id)
    ).resolves.toEqual({
      ok: true,
      value: { wasBlocked: true }
    });
    await expect(
      userBlocks.unblock(viewer.value.id, blocked.value.id)
    ).resolves.toEqual({
      ok: true,
      value: { wasBlocked: false }
    });
    const restoredComments = await comments.findByMatchId(
      sampleMatchDetail.id,
      viewer.value.id
    );
    expect(restoredComments.ok && restoredComments.value).toHaveLength(2);
  });

  it("stores, verifies, and revokes hashed account sessions", async () => {
    const account = await accounts.createLocalAccount({
      displayName: "Alex",
      normalizedDisplayName: "alex",
      passwordHash: "test-password-hash"
    });
    if (!account.ok) {
      throw new Error(account.error.message);
    }

    const created = await authSessions.create({
      userId: account.value.id,
      tokenHash: "a".repeat(64),
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    const active = await authSessions.findActivePrincipalByTokenHash(
      "a".repeat(64)
    );
    const revoked = await authSessions.revokeByTokenHash("a".repeat(64));
    const missing = await authSessions.findActivePrincipalByTokenHash(
      "a".repeat(64)
    );

    expect(created.ok && created.value.userId).toBe(account.value.id);
    expect(active.ok && active.value?.displayName).toBe("Alex");
    expect(revoked).toEqual({ ok: true, value: true });
    expect(missing).toEqual({ ok: true, value: null });
  });

  it("atomically rejects concurrent repeated comments", async () => {
    await publishSnapshot(createSnapshot("comment-duplicate"));
    const account = await accounts.createLocalAccount({
      displayName: "Fast Poster",
      normalizedDisplayName: "fast poster",
      passwordHash: "test-password-hash"
    });
    if (!account.ok) {
      throw new Error(account.error.message);
    }
    const input = {
      matchId: sampleMatchDetail.id,
      author: {
        kind: "account" as const,
        displayName: account.value.displayName,
        userId: account.value.id
      },
      body: "Same normalized comment.",
      normalizedBodyHash: "e".repeat(64)
    };

    const results = await Promise.all([
      transactions.runInTransaction((transaction) =>
        comments.createUnlessRecentDuplicate(
          input,
          "2000-01-01T00:00:00.000Z",
          transaction
        )
      ),
      transactions.runInTransaction((transaction) =>
        comments.createUnlessRecentDuplicate(
          input,
          "2000-01-01T00:00:00.000Z",
          transaction
        )
      )
    ]);
    const stored = await comments.findByMatchId(sampleMatchDetail.id);

    expect(
      results
        .map((result) => result.ok && result.value.status)
        .sort()
    ).toEqual(["created", "duplicate"]);
    expect(stored.ok && stored.value).toHaveLength(1);
  });

  it("persists, deduplicates, and resolves comment reports independently", async () => {
    await publishSnapshot(createSnapshot("comment-reporting"));
    const author = await accounts.createLocalAccount({
      displayName: "Reported Author",
      normalizedDisplayName: "reported author",
      passwordHash: "author-password-hash"
    });
    const reporter = await accounts.createLocalAccount({
      displayName: "Reporter",
      normalizedDisplayName: "reporter",
      passwordHash: "reporter-password-hash"
    });
    if (!author.ok || !reporter.ok) {
      throw new Error("Expected reporting accounts to be created.");
    }
    const comment = await comments.create({
      matchId: sampleMatchDetail.id,
      author: {
        kind: "account",
        displayName: author.value.displayName,
        userId: author.value.id
      },
      body: "A reportable comment."
    });
    if (!comment.ok) {
      throw new Error(comment.error.message);
    }

    const submitted = await transactions.runInTransaction(
      async (transaction) =>
        commentReports.submit(
          {
            id: "report-integration-1",
            commentId: comment.value.id,
            matchId: sampleMatchDetail.id,
            reporterUserId: reporter.value.id,
            reason: "harassment",
            context: "Please review this.",
            createdAt: "2026-07-23T12:00:00.000Z"
          },
          {
            earliestCreatedAt: "2026-07-23T11:50:00.000Z",
            now: "2026-07-23T12:00:00.000Z",
            maximumReports: 5,
            windowSeconds: 600
          },
          transaction
        )
    );
    const duplicate = await transactions.runInTransaction(
      async (transaction) =>
        commentReports.submit(
          {
            id: "report-integration-duplicate",
            commentId: comment.value.id,
            matchId: sampleMatchDetail.id,
            reporterUserId: reporter.value.id,
            reason: "spam",
            createdAt: "2026-07-23T12:01:00.000Z"
          },
          {
            earliestCreatedAt: "2026-07-23T11:51:00.000Z",
            now: "2026-07-23T12:01:00.000Z",
            maximumReports: 5,
            windowSeconds: 600
          },
          transaction
        )
    );
    const open = await commentReports.list("open", 10);
    await publishSnapshot(
      createSnapshot(
        "comment-reporting-refresh",
        sampleTournament.version + 1,
        "Updated Tournament"
      )
    );
    const afterPublication = await commentReports.list("open", 10);

    await transactions.runInTransaction(async (transaction) => {
      await commentReports.findByIdForUpdate(
        "report-integration-1",
        transaction
      );
      await comments.delete(comment.value.id, transaction);
      await commentReports.resolve(
        {
          reportId: "report-integration-1",
          reportedCommentId: comment.value.id,
          resolution: "comment_removed",
          moderatorId: "operator-1",
          resolvedAt: "2026-07-23T12:05:00.000Z",
          resolveAllForComment: true
        },
        transaction
      );
    });

    const visibleComments = await comments.findByMatchId(sampleMatchDetail.id);
    const resolved = await commentReports.list("resolved", 10);
    expect(submitted.ok && submitted.value.status).toBe("created");
    expect(duplicate.ok && duplicate.value).toMatchObject({
      status: "existing",
      report: { id: "report-integration-1" }
    });
    expect(open.ok && open.value[0]).toMatchObject({
      report: { id: "report-integration-1" },
      comment: { body: "A reportable comment." }
    });
    expect(afterPublication.ok && afterPublication.value[0].report.id).toBe(
      "report-integration-1"
    );
    expect(visibleComments).toEqual({ ok: true, value: [] });
    expect(resolved.ok && resolved.value[0].report).toMatchObject({
      status: "resolved",
      resolution: "comment_removed"
    });
  });

  it("deletes an account, every session, and authored comments atomically", async () => {
    await publishSnapshot(createSnapshot("account-deletion"));
    const deletedAccount = await accounts.createLocalAccount({
      displayName: "Delete Me",
      normalizedDisplayName: "delete me",
      passwordHash: "deleted-password-hash"
    });
    const retainedAccount = await accounts.createLocalAccount({
      displayName: "Keep Me",
      normalizedDisplayName: "keep me",
      passwordHash: "retained-password-hash"
    });
    if (!deletedAccount.ok || !retainedAccount.ok) {
      throw new Error("Expected test accounts to be created.");
    }

    const deletedTokenHash = "b".repeat(64);
    const retainedTokenHash = "c".repeat(64);
    await authSessions.create({
      userId: deletedAccount.value.id,
      tokenHash: deletedTokenHash,
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    await authSessions.create({
      userId: retainedAccount.value.id,
      tokenHash: retainedTokenHash,
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    const retainedComment = await comments.create({
      matchId: sampleMatchDetail.id,
      author: {
        kind: "account",
        displayName: deletedAccount.value.displayName,
        userId: deletedAccount.value.id
      },
      body: "Remove this comment."
    });
    await comments.create({
      matchId: sampleMatchDetail.id,
      author: {
        kind: "account",
        displayName: retainedAccount.value.displayName,
        userId: retainedAccount.value.id
      },
      body: "Keep this comment."
    });
    if (!retainedComment.ok) {
      throw new Error(retainedComment.error.message);
    }
    await transactions.runInTransaction(async (transaction) => {
      await userBlocks.block(
        {
          blockerUserId: deletedAccount.value.id,
          blockedUser: {
            userId: retainedAccount.value.id,
            displayName: retainedAccount.value.displayName
          },
          createdAt: "2026-07-23T11:58:00.000Z"
        },
        transaction
      );
      await userBlocks.block(
        {
          blockerUserId: retainedAccount.value.id,
          blockedUser: {
            userId: deletedAccount.value.id,
            displayName: deletedAccount.value.displayName
          },
          createdAt: "2026-07-23T11:59:00.000Z"
        },
        transaction
      );
    });
    await transactions.runInTransaction(async (transaction) => {
      await commentReports.submit(
        {
          id: "report-account-deletion",
          commentId: retainedComment.value.id,
          matchId: sampleMatchDetail.id,
          reporterUserId: deletedAccount.value.id,
          reason: "other",
          context: "Remove this private context with my account.",
          createdAt: "2026-07-23T12:00:00.000Z"
        },
        {
          earliestCreatedAt: "2026-07-23T11:50:00.000Z",
          now: "2026-07-23T12:00:00.000Z",
          maximumReports: 5,
          windowSeconds: 600
        },
        transaction
      );
    });

    const deletion = await transactions.runInTransaction(
      async (transaction) => {
        const result = await accounts.deleteById(
          deletedAccount.value.id,
          transaction
        );
        if (!result.ok) {
          throw new Error(result.error.message);
        }
        return result.value;
      }
    );

    const accountLookup =
      await accounts.findLocalAccountByNormalizedDisplayName("delete me");
    const deletedSession =
      await authSessions.findActivePrincipalByTokenHash(deletedTokenHash);
    const retainedSession =
      await authSessions.findActivePrincipalByTokenHash(retainedTokenHash);
    const storedComments = await comments.findByMatchId(sampleMatchDetail.id);
    const anonymizedReports = await commentReports.list("open", 10);
    const remainingBlocks = await database.query<{ block_count: string }>(
      "SELECT count(*) AS block_count FROM user_blocks"
    );
    const repeatedDeletion = await accounts.deleteById(deletedAccount.value.id);

    expect(deletion).toEqual({
      deleted: true,
      affectedMatchIds: [sampleMatchDetail.id]
    });
    expect(accountLookup).toEqual({ ok: true, value: null });
    expect(deletedSession).toEqual({ ok: true, value: null });
    expect(retainedSession.ok && retainedSession.value?.userId).toBe(
      retainedAccount.value.id
    );
    expect(storedComments.ok && storedComments.value.map((comment) => comment.body))
      .toEqual(["Keep this comment."]);
    expect(anonymizedReports.ok && anonymizedReports.value[0].report).toMatchObject({
      id: "report-account-deletion",
      reporterUserId: undefined,
      context: undefined
    });
    expect(remainingBlocks.rows[0]?.block_count).toBe("0");
    expect(repeatedDeletion).toEqual({
      ok: true,
      value: {
        deleted: false,
        affectedMatchIds: []
      }
    });
  });

  it("restores account data when deletion is rolled back", async () => {
    await publishSnapshot(createSnapshot("account-deletion-rollback"));
    const account = await accounts.createLocalAccount({
      displayName: "Rollback User",
      normalizedDisplayName: "rollback user",
      passwordHash: "rollback-password-hash"
    });
    if (!account.ok) {
      throw new Error(account.error.message);
    }
    const tokenHash = "d".repeat(64);
    await authSessions.create({
      userId: account.value.id,
      tokenHash,
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    await comments.create({
      matchId: sampleMatchDetail.id,
      author: {
        kind: "account",
        displayName: account.value.displayName,
        userId: account.value.id
      },
      body: "This comment should survive rollback."
    });

    await expect(
      transactions.runInTransaction(async (transaction) => {
        const result = await accounts.deleteById(account.value.id, transaction);
        if (!result.ok) {
          throw new Error(result.error.message);
        }
        throw new Error("Force account deletion rollback.");
      })
    ).rejects.toThrow("Force account deletion rollback.");

    const accountLookup =
      await accounts.findLocalAccountByNormalizedDisplayName("rollback user");
    const session = await authSessions.findActivePrincipalByTokenHash(tokenHash);
    const storedComments = await comments.findByMatchId(sampleMatchDetail.id);

    expect(accountLookup.ok && accountLookup.value?.account.id).toBe(
      account.value.id
    );
    expect(session.ok && session.value?.userId).toBe(account.value.id);
    expect(storedComments.ok && storedComments.value.map((comment) => comment.body))
      .toContain("This comment should survive rollback.");
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
