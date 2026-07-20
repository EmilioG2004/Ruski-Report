import { AuthConfig } from "../config/auth.config";
import { LocalAccountRecord, UserAccount } from "../domain";
import {
  AccountRepository,
  AuthSessionRepository,
  repositoryFailure,
  repositorySuccess,
  TransactionManager
} from "../repositories";
import { AuthService } from "./auth.service";
import { AuthCredentialsValidator } from "./auth-credentials.validator";
import { PasswordHasher } from "./password-hasher";
import { SessionTokenService } from "./session-token.service";

const config: AuthConfig = {
  maximumDisplayNameLength: 40,
  minimumPasswordLength: 10,
  maximumPasswordLength: 128,
  sessionLifetimeSeconds: 3600,
  passwordHash: {
    cost: 1024,
    blockSize: 8,
    parallelization: 1,
    keyLength: 32,
    saltLength: 16
  },
  sessionTokenLength: 32
};

const account: UserAccount = {
  id: "user-1",
  displayName: "Alex",
  normalizedDisplayName: "alex",
  provider: "local_account",
  status: "active",
  createdAt: "2026-07-20T12:00:00.000Z",
  updatedAt: "2026-07-20T12:00:00.000Z"
};

describe("AuthService", () => {
  it("registers an account and first session in one transaction", async () => {
    const dependencies = createDependencies();
    dependencies.passwordHasher.hash.mockResolvedValue("encoded-password");
    dependencies.accounts.createLocalAccount.mockResolvedValue(
      repositorySuccess(account)
    );
    dependencies.sessions.create.mockImplementation(async (input) =>
      repositorySuccess({
        userId: account.id,
        displayName: account.displayName,
        provider: account.provider,
        sessionId: "session-1",
        expiresAt: input.expiresAt
      })
    );

    const response = await dependencies.service.register({
      displayName: "  Alex  ",
      password: "password-123"
    });

    expect(dependencies.transactions.runInTransaction).toHaveBeenCalledTimes(1);
    expect(dependencies.accounts.createLocalAccount).toHaveBeenCalledWith(
      {
        displayName: "Alex",
        normalizedDisplayName: "alex",
        passwordHash: "encoded-password"
      },
      expect.objectContaining({ id: "transaction-1" })
    );
    expect(response.user).toEqual({
      id: "user-1",
      displayName: "Alex",
      provider: "local_account"
    });
    expect(response.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(dependencies.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      }),
      expect.objectContaining({ id: "transaction-1" })
    );
  });

  it("returns a generic unauthorized response for an unknown login", async () => {
    const dependencies = createDependencies();
    dependencies.accounts.findLocalAccountByNormalizedDisplayName.mockResolvedValue(
      repositorySuccess(null)
    );
    dependencies.passwordHasher.hash.mockResolvedValue("dummy-hash");

    await expect(
      dependencies.service.login({
        displayName: "Nobody",
        password: "password-123"
      })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Display name or password is incorrect.",
      statusCode: 401
    });
    expect(dependencies.passwordHasher.hash).toHaveBeenCalledWith("password-123");
  });

  it("logs in a local account after verifying its password", async () => {
    const dependencies = createDependencies();
    const record: LocalAccountRecord = {
      account,
      passwordHash: "encoded-password"
    };
    dependencies.accounts.findLocalAccountByNormalizedDisplayName.mockResolvedValue(
      repositorySuccess(record)
    );
    dependencies.passwordHasher.verify.mockResolvedValue(true);
    dependencies.sessions.create.mockImplementation(async (input) =>
      repositorySuccess({
        userId: account.id,
        displayName: account.displayName,
        provider: account.provider,
        sessionId: "session-2",
        expiresAt: input.expiresAt
      })
    );

    const response = await dependencies.service.login({
      displayName: "ALEX",
      password: "password-123"
    });

    expect(
      dependencies.accounts.findLocalAccountByNormalizedDisplayName
    ).toHaveBeenCalledWith("alex");
    expect(dependencies.passwordHasher.verify).toHaveBeenCalledWith(
      "password-123",
      "encoded-password"
    );
    expect(response.user.id).toBe("user-1");
  });

  it("maps duplicate display names to a conflict", async () => {
    const dependencies = createDependencies();
    dependencies.passwordHasher.hash.mockResolvedValue("encoded-password");
    dependencies.accounts.createLocalAccount.mockResolvedValue(
      repositoryFailure({ code: "conflict", message: "duplicate" })
    );

    await expect(
      dependencies.service.register({
        displayName: "Alex",
        password: "password-123"
      })
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });
});

function createDependencies(): {
  service: AuthService;
  accounts: jest.Mocked<AccountRepository>;
  sessions: jest.Mocked<AuthSessionRepository>;
  transactions: jest.Mocked<TransactionManager>;
  passwordHasher: jest.Mocked<PasswordHasher>;
} {
  const accounts = {
    createLocalAccount: jest.fn(),
    findLocalAccountByNormalizedDisplayName: jest.fn()
  } as jest.Mocked<AccountRepository>;
  const sessions = {
    create: jest.fn(),
    findActivePrincipalByTokenHash: jest.fn(),
    revokeByTokenHash: jest.fn()
  } as jest.Mocked<AuthSessionRepository>;
  const transactions = {
    runInTransaction: jest.fn(async (operation) =>
      operation({
        id: "transaction-1",
        startedAt: "2026-07-20T12:00:00.000Z"
      })
    )
  } as jest.Mocked<TransactionManager>;
  const passwordHasher = {
    hash: jest.fn(),
    verify: jest.fn()
  } as jest.Mocked<PasswordHasher>;

  return {
    accounts,
    sessions,
    transactions,
    passwordHasher,
    service: new AuthService(
      accounts,
      sessions,
      transactions,
      passwordHasher,
      new SessionTokenService(config),
      new AuthCredentialsValidator(config),
      config
    )
  };
}
