import { HttpStatus, Inject, Injectable } from "@nestjs/common";

import { AUTH_CONFIG, AuthConfig } from "../config/auth.config";
import { AuthenticatedPrincipal, UserAccount } from "../domain";
import { AppError } from "../errors";
import {
  ACCOUNT_REPOSITORY,
  AccountRepository,
  AUTH_SESSION_REPOSITORY,
  AuthSessionRepository,
  TRANSACTION_MANAGER,
  TransactionContext,
  TransactionManager
} from "../repositories";
import { requireAuthRepositoryValue } from "./auth-repository-result";
import { CreatedSessionResponse, currentSessionResponse } from "./auth-response";
import {
  AuthCredentialsRequest,
  AuthCredentialsValidator
} from "./auth-credentials.validator";
import { PASSWORD_HASHER, PasswordHasher } from "./password-hasher";
import { IssuedSessionToken, SessionTokenService } from "./session-token.service";

@Injectable()
export class AuthService {
  constructor(
    @Inject(ACCOUNT_REPOSITORY)
    private readonly accounts: AccountRepository,
    @Inject(AUTH_SESSION_REPOSITORY)
    private readonly sessions: AuthSessionRepository,
    @Inject(TRANSACTION_MANAGER)
    private readonly transactions: TransactionManager,
    @Inject(PASSWORD_HASHER)
    private readonly passwordHasher: PasswordHasher,
    private readonly tokens: SessionTokenService,
    private readonly credentialsValidator: AuthCredentialsValidator,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig
  ) {}

  async register(
    request: AuthCredentialsRequest | null | undefined
  ): Promise<CreatedSessionResponse> {
    const credentials = this.credentialsValidator.validate(request);
    const passwordHash = await this.passwordHasher.hash(credentials.password);
    const token = this.tokens.issue();
    const expiresAt = this.expirationDate();

    return this.transactions.runInTransaction(async (transaction) => {
      const account = await this.createAccount(
        credentials.displayName,
        credentials.normalizedDisplayName,
        passwordHash,
        transaction
      );
      const principal = requireAuthRepositoryValue(
        await this.sessions.create(
          { userId: account.id, tokenHash: token.hash, expiresAt },
          transaction
        ),
        "Unable to create account session."
      );
      return this.createdSessionResponse(principal, token);
    });
  }

  async login(
    request: AuthCredentialsRequest | null | undefined
  ): Promise<CreatedSessionResponse> {
    const credentials = this.credentialsValidator.validate(request);
    const record = requireAuthRepositoryValue(
      await this.accounts.findLocalAccountByNormalizedDisplayName(
        credentials.normalizedDisplayName
      ),
      "Unable to read account."
    );

    if (record === null) {
      await this.passwordHasher.hash(credentials.password);
      throw invalidCredentialsError();
    }

    const passwordMatches = await this.passwordHasher.verify(
      credentials.password,
      record.passwordHash
    );
    if (!passwordMatches || record.account.status !== "active") {
      throw invalidCredentialsError();
    }

    const token = this.tokens.issue();
    const principal = requireAuthRepositoryValue(
      await this.sessions.create({
        userId: record.account.id,
        tokenHash: token.hash,
        expiresAt: this.expirationDate()
      }),
      "Unable to create account session."
    );
    return this.createdSessionResponse(principal, token);
  }

  async authenticate(rawToken: string): Promise<AuthenticatedPrincipal> {
    const principal = requireAuthRepositoryValue(
      await this.sessions.findActivePrincipalByTokenHash(
        this.tokens.hash(rawToken)
      ),
      "Unable to verify account session."
    );

    if (principal === null) {
      throw unauthorizedSessionError();
    }

    return principal;
  }

  async signOut(tokenHash: string): Promise<void> {
    requireAuthRepositoryValue(
      await this.sessions.revokeByTokenHash(tokenHash),
      "Unable to revoke account session."
    );
  }

  private async createAccount(
    displayName: string,
    normalizedDisplayName: string,
    passwordHash: string,
    transaction: TransactionContext
  ): Promise<UserAccount> {
    const result = await this.accounts.createLocalAccount(
      { displayName, normalizedDisplayName, passwordHash },
      transaction
    );

    if (!result.ok && result.error.code === "conflict") {
      throw new AppError({
        code: "CONFLICT",
        message: "That display name is already in use.",
        statusCode: HttpStatus.CONFLICT,
        details: [
          {
            code: "DISPLAY_NAME_UNAVAILABLE",
            message: "That display name is already in use.",
            path: "displayName"
          }
        ]
      });
    }

    return requireAuthRepositoryValue(result, "Unable to create account.");
  }

  private expirationDate(): string {
    return new Date(
      Date.now() + this.config.sessionLifetimeSeconds * 1000
    ).toISOString();
  }

  private createdSessionResponse(
    principal: AuthenticatedPrincipal,
    token: IssuedSessionToken
  ): CreatedSessionResponse {
    return { ...currentSessionResponse(principal), token: token.raw };
  }
}

function invalidCredentialsError(): AppError {
  return new AppError({
    code: "UNAUTHORIZED",
    message: "Display name or password is incorrect.",
    statusCode: HttpStatus.UNAUTHORIZED
  });
}

export function unauthorizedSessionError(): AppError {
  return new AppError({
    code: "UNAUTHORIZED",
    message: "Sign in to continue.",
    statusCode: HttpStatus.UNAUTHORIZED
  });
}
