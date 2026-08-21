import { join } from "node:path";

import { loadAdministratorAuthConfig } from "../../config/admin-auth.config";
import { loadDatabaseConfig } from "../../config/database.config";
import { MigrationRunner, PostgresDatabase } from "../../database";
import { AdministratorPasswordHasher } from "./administrator-password.hasher";
import { AdministratorSecurityAuditService } from "./administrator-security-audit.service";
import { AdministratorSecurityRepository } from "./administrator-security.repository";
import { AdministratorSecurityService } from "./administrator-security.service";
import { AdministratorSecurityAuditEventInput } from "./administrator-security.types";
import { AdministratorSecurityTokens } from "./administrator-security.tokens";

const databaseUrl = process.env.TEST_DATABASE_URL;
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;

postgresDescribe("administrator security PostgreSQL", () => {
  let database: PostgresDatabase;
  let repository: AdministratorSecurityRepository;
  let service: AdministratorSecurityService;
  let audit: AdministratorSecurityAuditService;
  let tokens: AdministratorSecurityTokens;
  let config: ReturnType<typeof loadAdministratorAuthConfig>;

  beforeAll(async () => {
    const databaseConfig = loadDatabaseConfig({
      DATABASE_URL: databaseUrl,
      DATABASE_MIGRATIONS_DIR: join(process.cwd(), "migrations")
    });
    database = new PostgresDatabase(databaseConfig);
    await new MigrationRunner(database, databaseConfig).migrate();
  });

  beforeEach(async () => {
    await database.query(`
      TRUNCATE TABLE
        admin_security_audit_events,
        admin_rate_limit_buckets,
        admin_recovery_tokens,
        admin_invitations,
        admin_sessions,
        admin_account_credentials,
        admin_accounts
      CASCADE
    `);
    config = loadAdministratorAuthConfig({
      ADMIN_AUTH_SCRYPT_COST: "1024",
      ADMIN_AUTH_SCRYPT_KEY_LENGTH: "32",
      ADMIN_AUTH_LOGIN_IDENTITY_NETWORK_MAX: "50",
      ADMIN_AUTH_LOGIN_NETWORK_MAX: "50"
    });
    repository = new AdministratorSecurityRepository(database);
    tokens = new AdministratorSecurityTokens(config);
    audit = new AdministratorSecurityAuditService(repository, tokens);
    service = new AdministratorSecurityService(
      repository,
      new AdministratorPasswordHasher(config),
      tokens,
      audit,
      config
    );
  });

  afterAll(async () => {
    await database.onApplicationShutdown();
  });

  it("bootstraps, accepts once, stores only hashes, and authenticates sessions", async () => {
    const bootstrap = await service.createBootstrapInvitation({
      loginName: "Owner.One",
      displayName: "Tournament Owner"
    });
    const accepted = await service.acceptInvitation({
      token: bootstrap.rawToken,
      password: "correct-horse-battery"
    }, { networkIdentity: "test-network" });

    expect(accepted.principal).toMatchObject({
      loginName: "Owner.One",
      displayName: "Tournament Owner"
    });
    await expect(
      service.authenticateSession(accepted.rawSessionToken)
    ).resolves.toMatchObject({
      principal: { administratorId: accepted.principal.administratorId }
    });
    const rawTokenMatches = await database.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM admin_sessions
        WHERE token_hash = $1 OR csrf_token_hash = $2
      `,
      [accepted.rawSessionToken, accepted.rawCsrfToken]
    );
    expect(rawTokenMatches.rows[0]?.count).toBe("0");
    await expect(service.acceptInvitation({
      token: bootstrap.rawToken,
      password: "correct-horse-battery"
    }, { networkIdentity: "second-network" })).rejects.toMatchObject({
      details: [expect.objectContaining({ code: "ADMIN_TOKEN_INVALID" })]
    });
  });

  it("invites another administrator and recovery revokes every prior session", async () => {
    const owner = await createOwner();
    const invitation = await service.createInvitation({
      loginName: "operator-two",
      displayName: "Second Operator"
    }, owner.principal, { networkIdentity: "owner-network" });
    const operator = await service.acceptInvitation({
      token: invitation.rawToken,
      password: "operator-password-123"
    }, { networkIdentity: "operator-network" });
    const loggedIn = await service.login({
      loginName: "OPERATOR-TWO",
      password: "operator-password-123"
    }, { networkIdentity: "operator-login-network" });
    const recovery = await service.createRecoveryToken(
      operator.principal.administratorId,
      owner.principal,
      { networkIdentity: "owner-network" }
    );

    await service.completeRecovery({
      token: recovery.rawToken,
      password: "replacement-password-123"
    }, { networkIdentity: "operator-recovery-network" });

    await expect(
      service.authenticateSession(operator.rawSessionToken)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      service.authenticateSession(loggedIn.rawSessionToken)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(service.login({
      loginName: "operator-two",
      password: "replacement-password-123"
    }, { networkIdentity: "replacement-login-network" })).resolves.toMatchObject({
      principal: { administratorId: operator.principal.administratorId }
    });
  });

  it("persists rate limits and immutable sanitized security audit", async () => {
    const subject = "a".repeat(64);
    await expect(repository.consumeRateLimit(
      "test_limit",
      subject,
      { maximumAttempts: 1, windowSeconds: 60 }
    )).resolves.toEqual({ allowed: true });
    await expect(repository.consumeRateLimit(
      "test_limit",
      subject,
      { maximumAttempts: 1, windowSeconds: 60 }
    )).resolves.toMatchObject({ allowed: false });

    await audit.recordEvent({
      eventType: "sanitization_test",
      outcome: "rejected",
      networkIdentity: "192.0.2.1",
      userAgent: "Test Agent",
      details: {
        safeReason: "expected",
        password: "must-not-persist",
        nested: { csrfToken: "must-not-persist", safe: true }
      }
    });
    const row = await database.query<{
      id: string;
      details: Record<string, unknown>;
      network_key_hash: string;
    }>(
      `
        SELECT id, details, network_key_hash
        FROM admin_security_audit_events
        WHERE event_type = 'sanitization_test'
      `
    );
    expect(row.rows[0]).toMatchObject({
      details: { safeReason: "expected", nested: { safe: true } },
      network_key_hash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    await expect(database.query(
      "UPDATE admin_security_audit_events SET outcome = 'accepted' WHERE id = $1",
      [row.rows[0]?.id]
    )).rejects.toThrow("immutable");
  });

  it("serializes invitations by login and maps the losing token to a safe rejection", async () => {
    const owner = await createOwner();
    const invitations = await Promise.all([
      service.createInvitation({
        loginName: "concurrent-operator",
        displayName: "Concurrent Operator"
      }, owner.principal, { networkIdentity: "issuer-one" }),
      service.createInvitation({
        loginName: "concurrent-operator",
        displayName: "Concurrent Operator"
      }, owner.principal, { networkIdentity: "issuer-two" })
    ]);
    const pending = await database.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM admin_invitations
        WHERE normalized_login_name = 'concurrent-operator'
          AND accepted_at IS NULL AND revoked_at IS NULL
      `
    );
    expect(pending.rows[0]?.count).toBe("1");

    const attempts = await Promise.allSettled(invitations.map((invitation, index) =>
      service.acceptInvitation({
        token: invitation.rawToken,
        password: "concurrent-password-123"
      }, { networkIdentity: `accept-network-${index}` })
    ));
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find(
      (attempt): attempt is PromiseRejectedResult => attempt.status === "rejected"
    );
    expect(rejected?.reason).toMatchObject({
      details: [expect.objectContaining({ code: "ADMIN_TOKEN_INVALID" })]
    });
  });

  it("serializes recovery issuance and permits only one token consumption", async () => {
    const owner = await createOwner();
    const invitation = await service.createInvitation({
      loginName: "recovery-race",
      displayName: "Recovery Race"
    }, owner.principal, { networkIdentity: "recovery-race-invite" });
    const operator = await service.acceptInvitation({
      token: invitation.rawToken,
      password: "initial-password-123"
    }, { networkIdentity: "recovery-race-accept" });
    const recoveryTokens = await Promise.all([
      service.createRecoveryToken(
        operator.principal.administratorId,
        owner.principal,
        { networkIdentity: "recovery-issuer-one" }
      ),
      service.createRecoveryToken(
        operator.principal.administratorId,
        owner.principal,
        { networkIdentity: "recovery-issuer-two" }
      )
    ]);
    const pending = await database.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM admin_recovery_tokens
        WHERE administrator_id = $1
          AND consumed_at IS NULL AND revoked_at IS NULL
      `,
      [operator.principal.administratorId]
    );
    expect(pending.rows[0]?.count).toBe("1");

    const attempts = await Promise.allSettled(recoveryTokens.map((recovery, index) =>
      service.completeRecovery({
        token: recovery.rawToken,
        password: `replacement-password-${index + 1}`
      }, { networkIdentity: `recovery-consumer-${index}` })
    ));
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find(
      (attempt): attempt is PromiseRejectedResult => attempt.status === "rejected"
    );
    expect(rejected?.reason).toMatchObject({
      details: [expect.objectContaining({ code: "ADMIN_TOKEN_INVALID" })]
    });
  });

  it("audits login, token, and sensitive-action rate-limit denials", async () => {
    const rateConfig = loadAdministratorAuthConfig({
      ADMIN_AUTH_SCRYPT_COST: "1024",
      ADMIN_AUTH_SCRYPT_KEY_LENGTH: "32",
      ADMIN_AUTH_LOGIN_NETWORK_MAX: "1",
      ADMIN_AUTH_LOGIN_IDENTITY_NETWORK_MAX: "10",
      ADMIN_AUTH_TOKEN_NETWORK_MAX: "1",
      ADMIN_AUTH_SENSITIVE_ADMIN_MAX: "1"
    });
    const tokens = new AdministratorSecurityTokens(rateConfig);
    const rateAudit = new AdministratorSecurityAuditService(repository, tokens);
    const limited = new AdministratorSecurityService(
      repository,
      new AdministratorPasswordHasher(rateConfig),
      tokens,
      rateAudit,
      rateConfig
    );

    await expect(limited.login({
      loginName: "missing-user",
      password: "missing-password-123"
    }, { networkIdentity: "limited-login" })).rejects.toMatchObject({
      code: "UNAUTHORIZED"
    });
    await expect(limited.login({
      loginName: "missing-user",
      password: "missing-password-123"
    }, { networkIdentity: "limited-login" })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      details: [expect.objectContaining({
        metadata: { retryAfterSeconds: expect.any(Number) }
      })]
    });

    const invalidToken = "a".repeat(43);
    await expect(limited.acceptInvitation({
      token: invalidToken,
      password: "missing-password-123"
    }, { networkIdentity: "limited-token" })).rejects.toMatchObject({
      code: "BAD_REQUEST"
    });
    await expect(limited.acceptInvitation({
      token: invalidToken,
      password: "missing-password-123"
    }, { networkIdentity: "limited-token" })).rejects.toMatchObject({
      code: "RATE_LIMITED"
    });

    const owner = await createOwner();
    await limited.enforceSensitiveOperatorAction(
      { action: "tournament_setup_publish", targetType: "tournament" },
      owner.principal,
      { networkIdentity: "sensitive-network" }
    );
    await expect(limited.enforceSensitiveOperatorAction(
      { action: "tournament_setup_publish", targetType: "tournament" },
      owner.principal,
      { networkIdentity: "sensitive-network" }
    )).rejects.toMatchObject({ code: "RATE_LIMITED" });

    const rejected = await database.query<{
      event_type: string;
      reason_code: string;
    }>(
      `
        SELECT event_type, reason_code
        FROM admin_security_audit_events
        WHERE outcome = 'rejected' AND reason_code = 'rate_limited'
      `
    );
    expect(rejected.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining([
      "administrator_login",
      "administrator_invitation_accepted",
      "tournament_setup_publish"
    ]));
  });

  it("uses a composite cursor without skipping equal-time audit events", async () => {
    const ids = [
      "00000000-0000-4000-8000-000000000103",
      "00000000-0000-4000-8000-000000000102",
      "00000000-0000-4000-8000-000000000101"
    ];
    for (const id of ids) {
      await database.query(
        `
          INSERT INTO admin_security_audit_events (
            id, event_type, outcome, occurred_at
          ) VALUES ($1, 'pagination_test', 'accepted',
                    '2026-08-20T12:00:00.000Z')
        `,
        [id]
      );
    }
    const first = await audit.listEvents(2);
    const second = await audit.listEvents(2, first.nextCursor);

    expect(first.events.map((event) => event.id)).toEqual(ids.slice(0, 2));
    expect(second.events.map((event) => event.id)).toEqual(ids.slice(2));
    await expect(audit.listEvents(2, "invalid-cursor")).rejects.toMatchObject({
      details: [expect.objectContaining({ code: "ADMIN_AUDIT_CURSOR_INVALID" })]
    });
  });

  it("rolls back session and identity mutations when accepted audit insertion fails", async () => {
    const owner = await createOwner();
    const sessionCountBefore = await countRows("admin_sessions");
    const failedLogin = serviceWithFailingAudit(["administrator_login"]);

    await expect(failedLogin.login({
      loginName: "owner",
      password: "owner-password-123"
    }, { networkIdentity: "failed-login-audit" })).rejects.toThrow();
    await expect(countRows("admin_sessions")).resolves.toBe(sessionCountBefore);

    const failedLogout = serviceWithFailingAudit(["administrator_logout"]);
    await expect(failedLogout.logout(
      owner.principal,
      { networkIdentity: "failed-logout-audit" }
    )).rejects.toThrow();
    await expect(
      service.authenticateSession(owner.rawSessionToken)
    ).resolves.toMatchObject({
      principal: { administratorId: owner.principal.administratorId }
    });

    const invitation = await service.createInvitation({
      loginName: "rollback-accept",
      displayName: "Rollback Accept"
    }, owner.principal, { networkIdentity: "rollback-accept-issue" });
    const accountCountBefore = await countRows("admin_accounts");
    const failedAccept = serviceWithFailingAudit([
      "administrator_invitation_accepted"
    ]);
    await expect(failedAccept.acceptInvitation({
      token: invitation.rawToken,
      password: "rollback-password-123"
    }, { networkIdentity: "failed-accept-audit" })).rejects.toThrow();
    await expect(countRows("admin_accounts")).resolves.toBe(accountCountBefore);
    const invitationState = await database.query<{
      accepted_at: Date | null;
    }>("SELECT accepted_at FROM admin_invitations WHERE id = $1", [invitation.id]);
    expect(invitationState.rows[0]?.accepted_at).toBeNull();
  });

  it("rolls back invitation and recovery token mutations when audit insertion fails", async () => {
    const owner = await createOwner();
    const failedInvitationIssue = serviceWithFailingAudit([
      "administrator_invitation_created"
    ]);
    await expect(failedInvitationIssue.createInvitation({
      loginName: "rollback-issue",
      displayName: "Rollback Issue"
    }, owner.principal, { networkIdentity: "failed-invitation-audit" }))
      .rejects.toThrow();
    const absentInvitation = await database.query<{ count: string }>(
      `
        SELECT count(*)::text AS count FROM admin_invitations
        WHERE normalized_login_name = 'rollback-issue'
      `
    );
    expect(absentInvitation.rows[0]?.count).toBe("0");

    const invitation = await service.createInvitation({
      loginName: "rollback-revoke",
      displayName: "Rollback Revoke"
    }, owner.principal, { networkIdentity: "rollback-revoke-issue" });
    const failedRevoke = serviceWithFailingAudit([
      "administrator_invitation_revoked"
    ]);
    await expect(failedRevoke.revokeInvitation(
      invitation.id,
      owner.principal,
      { networkIdentity: "failed-revoke-audit" }
    )).rejects.toThrow();
    const invitationAfterRevoke = await database.query<{
      revoked_at: Date | null;
    }>("SELECT revoked_at FROM admin_invitations WHERE id = $1", [invitation.id]);
    expect(invitationAfterRevoke.rows[0]?.revoked_at).toBeNull();

    const operator = await service.acceptInvitation({
      token: invitation.rawToken,
      password: "operator-password-123"
    }, { networkIdentity: "rollback-recovery-accept" });
    const failedRecoveryIssue = serviceWithFailingAudit([
      "administrator_recovery_created"
    ]);
    await expect(failedRecoveryIssue.createRecoveryToken(
      operator.principal.administratorId,
      owner.principal,
      { networkIdentity: "failed-recovery-issue-audit" }
    )).rejects.toThrow();
    const recoveryCount = await database.query<{ count: string }>(
      `
        SELECT count(*)::text AS count FROM admin_recovery_tokens
        WHERE administrator_id = $1
      `,
      [operator.principal.administratorId]
    );
    expect(recoveryCount.rows[0]?.count).toBe("0");

    const recovery = await service.createRecoveryToken(
      operator.principal.administratorId,
      owner.principal,
      { networkIdentity: "rollback-recovery-issue" }
    );
    const failedRecoveryConsume = serviceWithFailingAudit([
      "administrator_recovery_completed"
    ]);
    await expect(failedRecoveryConsume.completeRecovery({
      token: recovery.rawToken,
      password: "replacement-password-123"
    }, { networkIdentity: "failed-recovery-consume-audit" })).rejects.toThrow();
    const recoveryState = await database.query<{ consumed_at: Date | null }>(
      "SELECT consumed_at FROM admin_recovery_tokens WHERE id = $1",
      [recovery.id]
    );
    expect(recoveryState.rows[0]?.consumed_at).toBeNull();
    await expect(
      service.authenticateSession(operator.rawSessionToken)
    ).resolves.toMatchObject({
      principal: { administratorId: operator.principal.administratorId }
    });
  });

  it("rolls back bootstrap before token handoff when audit insertion fails", async () => {
    const failedBootstrap = serviceWithFailingAudit([
      "administrator_bootstrap_created"
    ]);
    await expect(failedBootstrap.createBootstrapInvitation({
      loginName: "owner",
      displayName: "Owner"
    })).rejects.toThrow();
    await expect(countRows("admin_invitations")).resolves.toBe(0);

    await expect(service.createBootstrapInvitation({
      loginName: "owner",
      displayName: "Owner"
    })).resolves.toMatchObject({ rawToken: expect.any(String) });
  });

  it("audits malformed management identities and UUIDs as bad requests", async () => {
    const owner = await createOwner();
    await expect(service.createInvitation(
      null,
      owner.principal,
      { networkIdentity: "null-invitation" }
    )).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(service.revokeInvitation(
      "not-a-uuid",
      owner.principal,
      { networkIdentity: "invalid-invitation-id" }
    )).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(service.createRecoveryToken(
      "not-a-uuid",
      owner.principal,
      { networkIdentity: "invalid-administrator-id" }
    )).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const rejected = await database.query<{ event_type: string }>(
      `
        SELECT event_type FROM admin_security_audit_events
        WHERE outcome = 'rejected' AND reason_code = 'invalid_request'
      `
    );
    expect(rejected.rows.map((row) => row.event_type)).toEqual(
      expect.arrayContaining([
        "administrator_invitation_created",
        "administrator_invitation_revoked",
        "administrator_recovery_created"
      ])
    );
  });

  function serviceWithFailingAudit(
    eventTypes: readonly string[]
  ): AdministratorSecurityService {
    const failingAudit = new AdministratorSecurityAuditService(repository, tokens);
    const prepareEvent = failingAudit.prepareEvent.bind(failingAudit);
    jest.spyOn(failingAudit, "prepareEvent").mockImplementation(
      (input: AdministratorSecurityAuditEventInput) => {
        const prepared = prepareEvent(input);
        return eventTypes.includes(input.eventType)
          ? { ...prepared, eventType: "" }
          : prepared;
      }
    );
    return new AdministratorSecurityService(
      repository,
      new AdministratorPasswordHasher(config),
      tokens,
      failingAudit,
      config
    );
  }

  async function countRows(table: "admin_accounts" | "admin_invitations" |
  "admin_sessions"): Promise<number> {
    const result = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table}`
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async function createOwner() {
    const bootstrap = await service.createBootstrapInvitation({
      loginName: "owner",
      displayName: "Owner"
    });
    return service.acceptInvitation({
      token: bootstrap.rawToken,
      password: "owner-password-123"
    }, { networkIdentity: "bootstrap-network" });
  }
});
