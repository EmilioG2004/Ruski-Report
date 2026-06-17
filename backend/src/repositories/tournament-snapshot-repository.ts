import {
  GameType,
  ISODateTimeString,
  TournamentId
} from "../domain";
import { TournamentSnapshot } from "../games";
import { RepositoryResult } from "./repository-result";
import { TransactionContext } from "./transaction";

export type PublishSnapshotStatus = "published" | "rejected";

export interface PublishedSnapshotVersion {
  tournamentId: TournamentId;
  gameType: GameType;
  version: number;
  publishedAt: ISODateTimeString;
  previousVersion?: number;
}

export interface PublishSnapshotResult {
  status: PublishSnapshotStatus;
  snapshotVersion?: PublishedSnapshotVersion;
}

export interface TournamentSnapshotRepository {
  publishSnapshot(
    snapshot: TournamentSnapshot,
    transaction: TransactionContext
  ): Promise<RepositoryResult<PublishSnapshotResult>>;
}
