import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { PostgresDatabase } from "../../database";
import { AccountProvider, AccountStatus, LocalAccountRecord, UserAccount } from "../../domain";
import { AccountRepository, CreateLocalAccountInput } from "../account-repository";
import { repositoryFailure, RepositoryResult, repositorySuccess } from "../repository-result";
import { TransactionContext } from "../transaction";
import { selectPostgresExecutor } from "./postgres-executor";
import { mapPostgresError } from "./postgres-repository-error";
import { readISOString } from "./postgres-values";

interface LocalAccountRow {
  id: string;
  display_name: string;
  normalized_display_name: string;
  provider: AccountProvider;
  status: AccountStatus;
  created_at: Date | string;
  updated_at: Date | string;
  password_hash: string;
}

@Injectable()
export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async createLocalAccount(
    input: CreateLocalAccountInput,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<UserAccount>> {
    try {
      const executor = selectPostgresExecutor(this.database, transaction);
      const id = `user-${randomUUID()}`;
      const result = await executor.query<LocalAccountRow>(
        `
          WITH account AS (
            INSERT INTO user_accounts (
              id, display_name, normalized_display_name, provider
            ) VALUES ($1, $2, $3, 'local_account')
            RETURNING *
          ), credential AS (
            INSERT INTO local_account_credentials (user_id, password_hash)
            SELECT id, $4 FROM account
          )
          SELECT account.*, $4::text AS password_hash FROM account
        `,
        [id, input.displayName, input.normalizedDisplayName, input.passwordHash]
      );
      return repositorySuccess(mapAccount(result.rows[0]));
    } catch (error) {
      return repositoryFailure(mapPostgresError(error, "Failed to create account."));
    }
  }

  async findLocalAccountByNormalizedDisplayName(
    normalizedDisplayName: string
  ): Promise<RepositoryResult<LocalAccountRecord | null>> {
    try {
      const result = await this.database.query<LocalAccountRow>(
        `
          SELECT account.*, credential.password_hash
          FROM user_accounts account
          JOIN local_account_credentials credential ON credential.user_id = account.id
          WHERE account.normalized_display_name = $1
            AND account.provider = 'local_account'
        `,
        [normalizedDisplayName]
      );
      const row = result.rows[0];
      return repositorySuccess(
        row === undefined
          ? null
          : { account: mapAccount(row), passwordHash: row.password_hash }
      );
    } catch (error) {
      return repositoryFailure(mapPostgresError(error, "Failed to read account."));
    }
  }
}

function mapAccount(row: LocalAccountRow): UserAccount {
  return {
    id: row.id,
    displayName: row.display_name,
    normalizedDisplayName: row.normalized_display_name,
    provider: row.provider,
    status: row.status,
    createdAt: readISOString(row.created_at),
    updatedAt: readISOString(row.updated_at)
  };
}
