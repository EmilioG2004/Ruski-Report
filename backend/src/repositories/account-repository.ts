import { LocalAccountRecord, UserAccount } from "../domain";
import { RepositoryResult } from "./repository-result";
import { TransactionContext } from "./transaction";

export const ACCOUNT_REPOSITORY = Symbol("ACCOUNT_REPOSITORY");

export interface CreateLocalAccountInput {
  displayName: string;
  normalizedDisplayName: string;
  passwordHash: string;
}

export interface AccountRepository {
  createLocalAccount(
    input: CreateLocalAccountInput,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<UserAccount>>;

  findLocalAccountByNormalizedDisplayName(
    normalizedDisplayName: string
  ): Promise<RepositoryResult<LocalAccountRecord | null>>;
}
