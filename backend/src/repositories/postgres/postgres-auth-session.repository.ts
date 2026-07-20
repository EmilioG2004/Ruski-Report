import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { PostgresDatabase } from "../../database";
import { AccountProvider, AuthenticatedPrincipal } from "../../domain";
import { AuthSessionRepository, CreateAuthSessionInput } from "../auth-session-repository";
import { repositoryFailure, RepositoryResult, repositorySuccess } from "../repository-result";
import { TransactionContext } from "../transaction";
import { selectPostgresExecutor } from "./postgres-executor";
import { mapPostgresError } from "./postgres-repository-error";
import { readISOString } from "./postgres-values";

interface PrincipalRow {
  session_id: string;
  user_id: string;
  display_name: string;
  provider: AccountProvider;
  expires_at: Date | string;
}

@Injectable()
export class PostgresAuthSessionRepository implements AuthSessionRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async create(
    input: CreateAuthSessionInput,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<AuthenticatedPrincipal>> {
    try {
      const executor = selectPostgresExecutor(this.database, transaction);
      const result = await executor.query<PrincipalRow>(
        `
          WITH session AS (
            INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
            VALUES ($1, $2, $3, $4)
            RETURNING id, user_id, expires_at
          )
          SELECT session.id AS session_id, session.user_id,
                 account.display_name, account.provider, session.expires_at
          FROM session
          JOIN user_accounts account ON account.id = session.user_id
        `,
        [`session-${randomUUID()}`, input.userId, input.tokenHash, input.expiresAt]
      );
      return repositorySuccess(mapPrincipal(result.rows[0]));
    } catch (error) {
      return repositoryFailure(mapPostgresError(error, "Failed to create session."));
    }
  }

  async findActivePrincipalByTokenHash(
    tokenHash: string
  ): Promise<RepositoryResult<AuthenticatedPrincipal | null>> {
    try {
      const result = await this.database.query<PrincipalRow>(
        `
          UPDATE auth_sessions session
          SET last_seen_at = now()
          FROM user_accounts account
          WHERE session.token_hash = $1
            AND session.user_id = account.id
            AND session.revoked_at IS NULL
            AND session.expires_at > now()
            AND account.status = 'active'
          RETURNING session.id AS session_id, session.user_id,
                    account.display_name, account.provider, session.expires_at
        `,
        [tokenHash]
      );
      const row = result.rows[0];
      return repositorySuccess(row === undefined ? null : mapPrincipal(row));
    } catch (error) {
      return repositoryFailure(mapPostgresError(error, "Failed to verify session."));
    }
  }

  async revokeByTokenHash(tokenHash: string): Promise<RepositoryResult<boolean>> {
    try {
      const result = await this.database.query(
        `
          UPDATE auth_sessions
          SET revoked_at = now()
          WHERE token_hash = $1 AND revoked_at IS NULL
        `,
        [tokenHash]
      );
      return repositorySuccess((result.rowCount ?? 0) > 0);
    } catch (error) {
      return repositoryFailure(mapPostgresError(error, "Failed to revoke session."));
    }
  }
}

function mapPrincipal(row: PrincipalRow): AuthenticatedPrincipal {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    provider: row.provider,
    sessionId: row.session_id,
    expiresAt: readISOString(row.expires_at)
  };
}
