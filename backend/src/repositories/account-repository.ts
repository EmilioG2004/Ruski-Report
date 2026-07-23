import { LocalAccountRecord, MatchId, UserAccount } from "../domain";
import { RepositoryResult } from "./repository-result";
import { TransactionContext } from "./transaction";

export const ACCOUNT_REPOSITORY = Symbol("ACCOUNT_REPOSITORY");

export interface CreateLocalAccountInput {
  displayName: string;
  normalizedDisplayName: string;
  passwordHash: string;
}

export interface DeleteAccountResult {
  deleted: boolean;
  affectedMatchIds: MatchId[];
}

export interface AccountRepository {
  createLocalAccount(
    input: CreateLocalAccountInput,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<UserAccount>>;

  findLocalAccountByNormalizedDisplayName(
    normalizedDisplayName: string
  ): Promise<RepositoryResult<LocalAccountRecord | null>>;

  deleteById(
    userId: string,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<DeleteAccountResult>>;
}
