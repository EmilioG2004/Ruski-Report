import { TournamentId } from "../domain";
import { TournamentSnapshot } from "../games";
import {
  repositorySuccess,
  RepositoryResult
} from "./repository-result";
import {
  PublishSnapshotResult,
  TournamentSnapshotRepository
} from "./tournament-snapshot-repository";
import { TransactionContext } from "./transaction";

interface StoredTournamentSnapshot {
  snapshot: TournamentSnapshot;
  publishedAt: string;
  transaction: TransactionContext;
}

export class InMemoryTournamentSnapshotRepository
  implements TournamentSnapshotRepository
{
  private readonly snapshotsByTournamentId = new Map<
    TournamentId,
    StoredTournamentSnapshot[]
  >();

  async publishSnapshot(
    snapshot: TournamentSnapshot,
    transaction: TransactionContext
  ): Promise<RepositoryResult<PublishSnapshotResult>> {
    const publishedAt = new Date().toISOString();
    const existingSnapshots =
      this.snapshotsByTournamentId.get(snapshot.tournament.id) ?? [];
    const previousVersion =
      existingSnapshots.at(-1)?.snapshot.tournament.version;

    this.snapshotsByTournamentId.set(snapshot.tournament.id, [
      ...existingSnapshots,
      {
        snapshot,
        publishedAt,
        transaction
      }
    ]);

    return repositorySuccess({
      status: "published",
      snapshotVersion: {
        tournamentId: snapshot.tournament.id,
        gameType: snapshot.tournament.gameType,
        version: snapshot.tournament.version,
        publishedAt,
        previousVersion
      }
    });
  }

  getLatestSnapshot(tournamentId: TournamentId): TournamentSnapshot | null {
    return (
      this.snapshotsByTournamentId.get(tournamentId)?.at(-1)?.snapshot ?? null
    );
  }
}
