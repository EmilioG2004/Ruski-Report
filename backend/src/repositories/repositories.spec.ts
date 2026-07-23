import {
  Comment,
  MatchDetail,
  MatchSummary,
  Tournament,
  TournamentSummary
} from "../domain";
import {
  TournamentSnapshot,
  validationFailed,
  validationPassed
} from "../games";
import { CommentRepository } from "./comment-repository";
import {
  repositoryFailure,
  repositorySuccess,
  RepositoryResult
} from "./repository-result";
import { TournamentReadRepository } from "./tournament-read-repository";
import {
  PublishSnapshotResult,
  TournamentSnapshotRepository
} from "./tournament-snapshot-repository";
import { TransactionContext, TransactionManager } from "./transaction";
import {
  UploadReport,
  UploadReportRepository
} from "./upload-report-repository";

const now = "2026-06-17T12:00:00.000Z";

class FakeTransactionManager implements TransactionManager {
  committed = false;
  rolledBack = false;

  async runInTransaction<T>(
    operation: (transaction: TransactionContext) => Promise<T>
  ): Promise<T> {
    const transaction = {
      id: "tx-1",
      startedAt: now
    };

    try {
      const result = await operation(transaction);
      this.committed = true;
      return result;
    } catch (error) {
      this.rolledBack = true;
      throw error;
    }
  }
}

class FakeSnapshotRepository implements TournamentSnapshotRepository {
  publishedSnapshots: TournamentSnapshot[] = [];
  activeVersion?: number;
  shouldFail = false;

  async publishSnapshot(
    snapshot: TournamentSnapshot,
    _transaction: TransactionContext
  ): Promise<RepositoryResult<PublishSnapshotResult>> {
    if (this.shouldFail) {
      return repositoryFailure({
        code: "storage_failed",
        message: "Unable to write snapshot."
      });
    }

    const previousVersion = this.activeVersion;
    const version = snapshot.tournament.version;

    this.publishedSnapshots.push(snapshot);
    this.activeVersion = version;

    return repositorySuccess({
      status: "published",
      snapshotVersion: {
        tournamentId: snapshot.tournament.id,
        gameType: snapshot.tournament.gameType,
        version,
        publishedAt: now,
        previousVersion
      }
    });
  }
}

class FakeTournamentReadRepository implements TournamentReadRepository {
  constructor(
    private readonly tournament: Tournament,
    private readonly matches: MatchDetail[]
  ) {}

  async findActiveTournament(): Promise<
    RepositoryResult<TournamentSummary | null>
  > {
    return repositorySuccess(this.tournament);
  }

  async findTournamentById(
    _tournamentId: string
  ): Promise<RepositoryResult<Tournament | null>> {
    return repositorySuccess(this.tournament);
  }

  async findMatchesByTournamentId(
    _tournamentId: string
  ): Promise<RepositoryResult<MatchSummary[]>> {
    return repositorySuccess(this.matches);
  }

  async findMatchDetail(
    _matchId: string
  ): Promise<RepositoryResult<MatchDetail | null>> {
    return repositorySuccess(this.matches[0] ?? null);
  }
}

class FakeCommentRepository implements CommentRepository {
  private comments: Comment[] = [];

  async findByMatchId(matchId: string): Promise<RepositoryResult<Comment[]>> {
    return repositorySuccess(
      this.comments.filter((comment) => comment.matchId === matchId)
    );
  }

  async create(input: {
    matchId: string;
    author: Comment["author"];
    body: string;
  }): Promise<RepositoryResult<Comment>> {
    const comment = {
      id: `comment-${this.comments.length + 1}`,
      matchId: input.matchId,
      author: input.author,
      body: input.body,
      createdAt: now
    };

    this.comments.push(comment);
    return repositorySuccess(comment);
  }

  async createUnlessRecentDuplicate(
    input: {
      matchId: string;
      author: Comment["author"];
      body: string;
    },
    _earliestDuplicateCreatedAt: string,
    _transaction: TransactionContext
  ) {
    const created = await this.create(input);
    return created.ok
      ? repositorySuccess({
          status: "created" as const,
          comment: created.value
        })
      : created;
  }

  async delete(commentId: string): Promise<RepositoryResult<Comment>> {
    const comment = this.comments.find((candidate) => candidate.id === commentId);

    if (comment === undefined) {
      return repositoryFailure({
        code: "not_found",
        message: "Comment not found."
      });
    }

    const deleted = {
      ...comment,
      deletedAt: now
    };

    this.comments = this.comments.map((candidate) =>
      candidate.id === commentId ? deleted : candidate
    );

    return repositorySuccess(deleted);
  }
}

class FakeUploadReportRepository implements UploadReportRepository {
  private reports = new Map<string, UploadReport>();

  async create(report: UploadReport): Promise<RepositoryResult<UploadReport>> {
    this.reports.set(report.id, report);
    return repositorySuccess(report);
  }

  async update(report: UploadReport): Promise<RepositoryResult<UploadReport>> {
    this.reports.set(report.id, report);
    return repositorySuccess(report);
  }

  async findById(id: string): Promise<RepositoryResult<UploadReport | null>> {
    return repositorySuccess(this.reports.get(id) ?? null);
  }
}

function createTournament(): Tournament {
  return {
    id: "tournament-2026",
    year: 2026,
    name: "2026 Ruski Tournament",
    gameType: "ruski",
    status: "active",
    format: {
      type: "pod_and_bracket",
      podCount: 8,
      teamsPerPod: 4,
      bracketSize: 16
    },
    activeMatchIds: ["match-1"],
    featuredMatchIds: ["match-1"],
    pods: [],
    teams: [],
    standings: [],
    matchSummaries: [],
    version: 2,
    updatedAt: now
  };
}

function createMatch(tournament: Tournament): MatchDetail {
  return {
    id: "match-1",
    tournamentId: tournament.id,
    gameType: tournament.gameType,
    status: "final",
    participants: [
      {
        teamId: "team-1",
        score: 1,
        result: "win"
      },
      {
        teamId: "team-2",
        score: 0,
        result: "loss"
      }
    ],
    score: {
      participants: [
        {
          teamId: "team-1",
          score: 1
        },
        {
          teamId: "team-2",
          score: 0
        }
      ],
      winnerTeamId: "team-1",
      isFinal: true
    },
    boxScore: {
      matchId: "match-1",
      gameType: tournament.gameType,
      rows: []
    },
    scorecard: {
      definition: {
        id: "ruski-scorecard",
        gameType: tournament.gameType,
        name: "Ruski Scorecard",
        columns: []
      },
      rows: []
    },
    events: [],
    version: 2,
    updatedAt: now
  };
}

function createSnapshot(): TournamentSnapshot {
  const tournament = createTournament();
  const match = createMatch(tournament);

  return {
    tournament: {
      ...tournament,
      matchSummaries: [match]
    },
    matches: [match],
    gameDefinition: {
      gameType: "ruski",
      displayName: "Ruski",
      phases: [],
      eventTypes: [],
      stats: [],
      scorecardDefinitionId: "ruski-scorecard"
    },
    source: {
      originalName: "2026 Ruski Stat Sheet.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    },
    validation: validationPassed(),
    generatedAt: now
  };
}

describe("repository contracts", () => {
  it("publishes snapshots through an explicit transaction boundary", async () => {
    const transactionManager = new FakeTransactionManager();
    const repository = new FakeSnapshotRepository();
    const snapshot = createSnapshot();

    const result = await transactionManager.runInTransaction((transaction) =>
      repository.publishSnapshot(snapshot, transaction)
    );

    expect(result).toEqual(
      repositorySuccess({
        status: "published",
        snapshotVersion: {
          tournamentId: "tournament-2026",
          gameType: "ruski",
          version: 2,
          publishedAt: now,
          previousVersion: undefined
        }
      })
    );
    expect(transactionManager.committed).toBe(true);
    expect(transactionManager.rolledBack).toBe(false);
    expect(repository.activeVersion).toBe(2);
    expect(repository.publishedSnapshots).toHaveLength(1);
  });

  it("keeps the active snapshot unchanged when publish fails", async () => {
    const transactionManager = new FakeTransactionManager();
    const repository = new FakeSnapshotRepository();
    repository.activeVersion = 1;
    repository.shouldFail = true;

    await expect(
      transactionManager.runInTransaction(async (transaction) => {
        const result = await repository.publishSnapshot(
          createSnapshot(),
          transaction
        );

        if (!result.ok) {
          throw new Error(result.error.message);
        }

        return result;
      })
    ).rejects.toThrow("Unable to write snapshot.");

    expect(transactionManager.committed).toBe(false);
    expect(transactionManager.rolledBack).toBe(true);
    expect(repository.activeVersion).toBe(1);
    expect(repository.publishedSnapshots).toHaveLength(0);
  });

  it("separates tournament read models from match detail reads", async () => {
    const snapshot = createSnapshot();
    const repository = new FakeTournamentReadRepository(
      snapshot.tournament,
      snapshot.matches
    );

    const activeTournament = await repository.findActiveTournament();
    const matchSummaries = await repository.findMatchesByTournamentId(
      snapshot.tournament.id
    );
    const matchDetail = await repository.findMatchDetail("match-1");

    expect(activeTournament.ok && activeTournament.value?.id).toBe(
      "tournament-2026"
    );
    expect(matchSummaries.ok && matchSummaries.value[0]).not.toHaveProperty(
      "source"
    );
    expect(matchDetail.ok && matchDetail.value).toHaveProperty("scorecard");
  });

  it("keeps comments separate from snapshot publishing", async () => {
    const repository = new FakeCommentRepository();

    const created = await repository.create({
      matchId: "match-1",
      author: {
        kind: "guest",
        displayName: "Guest"
      },
      body: "Great match."
    });
    const comments = await repository.findByMatchId("match-1");

    expect(created.ok && created.value.body).toBe("Great match.");
    expect(comments.ok && comments.value).toHaveLength(1);
  });

  it("stores upload reports for validation failures and publish success", async () => {
    const repository = new FakeUploadReportRepository();
    const validationFailedReport: UploadReport = {
      id: "upload-1",
      gameType: "ruski",
      source: {
        originalName: "bad.xlsx"
      },
      status: "validation_failed",
      validation: validationFailed([
        {
          code: "MISSING_TAB",
          message: "Required tab is missing.",
          severity: "error",
          path: "sheets.Regular Season Standings"
        }
      ]),
      receivedAt: now,
      completedAt: now
    };
    const publishedReport: UploadReport = {
      id: "upload-2",
      gameType: "ruski",
      source: {
        originalName: "good.xlsx"
      },
      status: "published",
      validation: validationPassed(),
      tournamentId: "tournament-2026",
      snapshotVersion: {
        tournamentId: "tournament-2026",
        gameType: "ruski",
        version: 2,
        publishedAt: now,
        previousVersion: 1
      },
      receivedAt: now,
      completedAt: now
    };

    await repository.create(validationFailedReport);
    await repository.create(publishedReport);

    const failedLookup = await repository.findById("upload-1");
    const publishedLookup = await repository.findById("upload-2");

    expect(failedLookup.ok && failedLookup.value?.status).toBe(
      "validation_failed"
    );
    expect(publishedLookup.ok && publishedLookup.value?.snapshotVersion).toMatchObject({
      version: 2,
      previousVersion: 1
    });
  });
});
