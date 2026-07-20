import { AuthenticatedPrincipal, ISODateTimeString } from "../domain";
import { RepositoryResult } from "./repository-result";
import { TransactionContext } from "./transaction";

export const AUTH_SESSION_REPOSITORY = Symbol("AUTH_SESSION_REPOSITORY");

export interface CreateAuthSessionInput {
  userId: string;
  tokenHash: string;
  expiresAt: ISODateTimeString;
}

export interface AuthSessionRepository {
  create(
    input: CreateAuthSessionInput,
    transaction?: TransactionContext
  ): Promise<RepositoryResult<AuthenticatedPrincipal>>;

  findActivePrincipalByTokenHash(
    tokenHash: string
  ): Promise<RepositoryResult<AuthenticatedPrincipal | null>>;

  revokeByTokenHash(tokenHash: string): Promise<RepositoryResult<boolean>>;
}
