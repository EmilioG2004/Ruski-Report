import { Inject, Injectable } from "@nestjs/common";

import {
  ADMIN_AUTH_CONFIG,
  AdministratorAuthConfig,
  RateLimitConfig
} from "../../config/admin-auth.config";
import {
  administratorConflictError,
  administratorRateLimitedError,
  administratorUnauthorizedError,
  invalidAdministratorCredentialsError,
  invalidAdministratorInputError,
  invalidAdministratorTokenError,
  recentAuthenticationRequiredError
} from "./administrator-security.errors";
import { AdministratorPasswordHasher } from "./administrator-password.hasher";
import {
  AdministratorAccountUnavailableError,
  AdministratorBootstrapUnavailableError,
  AdministratorIdentityConflictError,
  AdministratorSecurityRepository,
  AdministratorTokenUnavailableError
} from "./administrator-security.repository";
import { AdministratorSecurityAuditService } from "./administrator-security-audit.service";
import {
  AdministratorIdentityInput,
  AdministratorPrincipal,
  AdministratorRequestContext,
  AuthenticatedAdministratorSession,
  IssuedAdministratorSession,
  IssuedAdministratorToken
} from "./administrator-security.types";
import { AdministratorSecurityTokens } from "./administrator-security.tokens";

export interface AdministratorLoginRequest {
  loginName?: string;
  password?: string;
}

export interface AdministratorInvitationAcceptanceRequest {
  token?: string;
  password?: string;
}

export interface SensitiveAdministratorActionInput {
  action: string;
  targetType?: string;
  targetId?: string;
}

@Injectable()
export class AdministratorSecurityService {
  constructor(
    private readonly repository: AdministratorSecurityRepository,
    private readonly passwordHasher: AdministratorPasswordHasher,
    private readonly tokens: AdministratorSecurityTokens,
    private readonly audit: AdministratorSecurityAuditService,
    @Inject(ADMIN_AUTH_CONFIG)
    private readonly config: AdministratorAuthConfig
  ) {}

  async issuePreAuthCsrf(
    context: AdministratorRequestContext
  ): Promise<{ token: string; expiresAt: string }> {
    await this.enforceRateLimit(
      "preauth_network",
      networkSubject(context),
      this.config.rateLimits.preAuthPerNetwork,
      "administrator_preauth_csrf_issued",
      context
    );
    return this.tokens.issuePreAuthCsrf();
  }

  verifyPreAuthCsrf(token: string): boolean {
    return this.tokens.verifyPreAuthCsrf(token);
  }

  async login(
    request: AdministratorLoginRequest | null | undefined,
    context: AdministratorRequestContext
  ): Promise<IssuedAdministratorSession> {
    const loginName = request?.loginName?.trim() ?? "";
    const normalizedLoginName = normalizeLoginName(loginName);
    const password = request?.password ?? "";
    await this.enforceRateLimit(
      "login_network",
      networkSubject(context),
      this.config.rateLimits.loginPerNetwork,
      "administrator_login",
      context
    );
    await this.enforceRateLimit(
      "login_identity_network",
      `${networkSubject(context)}:${normalizedLoginName}`,
      this.config.rateLimits.loginPerIdentityAndNetwork,
      "administrator_login",
      context
    );

    const structurallyValid = isValidLoginName(loginName) &&
      this.isValidPassword(password);
    const credential = structurallyValid
      ? await this.repository.findCredential(normalizedLoginName)
      : null;
    if (credential === null || credential.hashAlgorithm !== "scrypt" ||
        credential.hashVersion !== 1) {
      await this.passwordHasher.hash("bounded-invalid-password-work");
      await this.recordRejected("administrator_login", "invalid_credentials", context);
      throw invalidAdministratorCredentialsError();
    }

    const passwordMatches = await this.passwordHasher.verify(
      password,
      credential.passwordHash
    );
    if (!passwordMatches || credential.status !== "active") {
      await this.recordRejected("administrator_login", "invalid_credentials", context);
      throw invalidAdministratorCredentialsError();
    }

    const session = this.tokens.issueOpaqueToken();
    const csrf = this.tokens.issueOpaqueToken();
    try {
      const principal = await this.repository.createSession({
        administratorId: credential.administratorId,
        tokenHash: session.hash,
        csrfTokenHash: csrf.hash,
        sessionLifetimeSeconds: this.config.sessionLifetimeSeconds,
        idleLifetimeSeconds: this.config.sessionIdleLifetimeSeconds,
        audit: this.audit.prepareEvent({
          eventType: "administrator_login",
          outcome: "accepted",
          ...context
        }),
        ...(this.passwordHasher.needsRehash(credential.passwordHash)
          ? { replacementPasswordHash: await this.passwordHasher.hash(password) }
          : {})
      });
      return {
        principal,
        rawSessionToken: session.raw,
        rawCsrfToken: csrf.raw
      };
    } catch (error) {
      if (error instanceof AdministratorAccountUnavailableError) {
        await this.recordRejected(
          "administrator_login",
          "invalid_credentials",
          context
        );
        throw invalidAdministratorCredentialsError();
      }
      throw error;
    }
  }

  async authenticateSession(
    rawSessionToken: string
  ): Promise<AuthenticatedAdministratorSession> {
    const authenticated = await this.repository.authenticateSession(
      this.tokens.hashOpaqueToken(rawSessionToken),
      this.config.sessionIdleLifetimeSeconds
    );
    if (authenticated === null) {
      throw administratorUnauthorizedError();
    }
    return authenticated;
  }

  verifyAuthenticatedCsrf(
    rawCsrfToken: string,
    expectedHash: string
  ): boolean {
    return this.tokens.matches(
      this.tokens.hashOpaqueToken(rawCsrfToken),
      expectedHash
    );
  }

  async logout(
    principal: AdministratorPrincipal,
    context: AdministratorRequestContext
  ): Promise<void> {
    await this.repository.revokeSession({
      sessionId: principal.sessionId,
      administratorId: principal.administratorId,
      reason: "administrator_logout",
      audit: this.audit.prepareEvent({
        eventType: "administrator_logout",
        outcome: "accepted",
        ...context
      })
    });
  }

  async createInvitation(
    identity: AdministratorIdentityInput | null | undefined,
    principal: AdministratorPrincipal,
    context: AdministratorRequestContext
  ): Promise<IssuedAdministratorToken> {
    await this.requireRecentAuthenticationAudited(
      "administrator_invitation_created",
      principal,
      context
    );
    await this.enforceSensitiveOperatorAction(
      { action: "administrator_invitation_create", targetType: "invitation" },
      principal,
      context
    );
    let validated: ReturnType<typeof validateIdentity>;
    try {
      validated = validateIdentity(identity);
    } catch (error) {
      await this.recordRejected(
        "administrator_invitation_created",
        "invalid_request",
        context,
        principal
      );
      throw error;
    }
    const token = this.tokens.issueOpaqueToken();
    try {
      const row = await this.repository.createInvitation({
        identity: validated,
        tokenHash: token.hash,
        issuerAdministratorId: principal.administratorId,
        lifetimeSeconds: this.config.invitationLifetimeSeconds,
        audit: this.audit.prepareEvent({
          eventType: "administrator_invitation_created",
          outcome: "accepted",
          administratorId: principal.administratorId,
          sessionId: principal.sessionId,
          ...context
        })
      });
      return { id: row.id, rawToken: token.raw, expiresAt: iso(row.expires_at) };
    } catch (error) {
      if (error instanceof AdministratorIdentityConflictError) {
        await this.recordRejected(
          "administrator_invitation_created",
          "identity_conflict",
          context,
          principal
        );
        throw administratorConflictError("Administrator login name is unavailable.");
      }
      throw error;
    }
  }

  async revokeInvitation(
    invitationId: string,
    principal: AdministratorPrincipal,
    context: AdministratorRequestContext
  ): Promise<void> {
    await this.requireRecentAuthenticationAudited(
      "administrator_invitation_revoked",
      principal,
      context
    );
    let validatedInvitationId: string;
    try {
      validatedInvitationId = validateApplicationUuid(
        invitationId,
        "invitationId"
      );
    } catch (error) {
      await this.recordRejected(
        "administrator_invitation_revoked",
        "invalid_request",
        context,
        principal
      );
      throw error;
    }
    await this.enforceSensitiveOperatorAction({
      action: "administrator_invitation_revoke",
      targetType: "administrator_invitation",
      targetId: validatedInvitationId
    }, principal, context);
    const revoked = await this.repository.revokeInvitation({
      invitationId: validatedInvitationId,
      issuerAdministratorId: principal.administratorId,
      audit: this.audit.prepareEvent({
        eventType: "administrator_invitation_revoked",
        outcome: "accepted",
        administratorId: principal.administratorId,
        sessionId: principal.sessionId,
        ...context
      })
    });
    if (!revoked) {
      await this.recordRejected(
        "administrator_invitation_revoked",
        "invitation_unavailable",
        context,
        principal
      );
      throw invalidAdministratorTokenError();
    }
  }

  async acceptInvitation(
    request: AdministratorInvitationAcceptanceRequest | null | undefined,
    context: AdministratorRequestContext
  ): Promise<IssuedAdministratorSession> {
    await this.enforceRateLimit(
      "invitation_accept_network",
      networkSubject(context),
      this.config.rateLimits.tokenUsePerNetwork,
      "administrator_invitation_accepted",
      context
    );
    let rawToken: string;
    let password: string;
    try {
      rawToken = validateRawToken(request?.token);
      password = validatePassword(request?.password, this.config);
    } catch (error) {
      await this.recordRejected(
        "administrator_invitation_accepted",
        "invalid_request",
        context
      );
      throw error;
    }
    const passwordHash = await this.passwordHasher.hash(password);
    const session = this.tokens.issueOpaqueToken();
    const csrf = this.tokens.issueOpaqueToken();
    try {
      const principal = await this.repository.acceptInvitation({
        tokenHash: this.tokens.hashOpaqueToken(rawToken),
        passwordHash,
        sessionTokenHash: session.hash,
        csrfTokenHash: csrf.hash,
        sessionLifetimeSeconds: this.config.sessionLifetimeSeconds,
        idleLifetimeSeconds: this.config.sessionIdleLifetimeSeconds,
        audit: this.audit.prepareEvent({
          eventType: "administrator_invitation_accepted",
          outcome: "accepted",
          ...context
        })
      });
      return {
        principal,
        rawSessionToken: session.raw,
        rawCsrfToken: csrf.raw
      };
    } catch (error) {
      if (error instanceof AdministratorTokenUnavailableError ||
          error instanceof AdministratorIdentityConflictError) {
        await this.recordRejected(
          "administrator_invitation_accepted",
          "token_unavailable",
          context
        );
        throw invalidAdministratorTokenError();
      }
      throw error;
    }
  }

  async createRecoveryToken(
    targetAdministratorId: string,
    principal: AdministratorPrincipal,
    context: AdministratorRequestContext
  ): Promise<IssuedAdministratorToken> {
    await this.requireRecentAuthenticationAudited(
      "administrator_recovery_created",
      principal,
      context
    );
    let validatedAdministratorId: string;
    try {
      validatedAdministratorId = validateApplicationUuid(
        targetAdministratorId,
        "administratorId"
      );
    } catch (error) {
      await this.recordRejected(
        "administrator_recovery_created",
        "invalid_request",
        context,
        principal
      );
      throw error;
    }
    await this.enforceSensitiveOperatorAction({
      action: "administrator_recovery_create",
      targetType: "administrator_account",
      targetId: validatedAdministratorId
    }, principal, context);
    try {
      const token = this.tokens.issueOpaqueToken();
      const row = await this.repository.createRecoveryToken({
        targetAdministratorId: validatedAdministratorId,
        tokenHash: token.hash,
        issuedByAdministratorId: principal.administratorId,
        lifetimeSeconds: this.config.recoveryLifetimeSeconds,
        audit: this.audit.prepareEvent({
          eventType: "administrator_recovery_created",
          outcome: "accepted",
          administratorId: principal.administratorId,
          sessionId: principal.sessionId,
          ...context
        })
      });
      return { id: row.id, rawToken: token.raw, expiresAt: iso(row.expires_at) };
    } catch (error) {
      if (error instanceof AdministratorAccountUnavailableError) {
        await this.recordRejected(
          "administrator_recovery_created",
          "account_unavailable",
          context,
          principal
        );
        throw invalidAdministratorTokenError();
      }
      throw error;
    }
  }

  async completeRecovery(
    request: AdministratorInvitationAcceptanceRequest | null | undefined,
    context: AdministratorRequestContext
  ): Promise<void> {
    await this.enforceRateLimit(
      "recovery_complete_network",
      networkSubject(context),
      this.config.rateLimits.tokenUsePerNetwork,
      "administrator_recovery_completed",
      context
    );
    let rawToken: string;
    let password: string;
    try {
      rawToken = validateRawToken(request?.token);
      password = validatePassword(request?.password, this.config);
    } catch (error) {
      await this.recordRejected(
        "administrator_recovery_completed",
        "invalid_request",
        context
      );
      throw error;
    }
    const passwordHash = await this.passwordHasher.hash(password);
    try {
      await this.repository.consumeRecoveryToken(
        this.tokens.hashOpaqueToken(rawToken),
        passwordHash,
        this.audit.prepareEvent({
          eventType: "administrator_recovery_completed",
          outcome: "accepted",
          ...context
        })
      );
    } catch (error) {
      if (error instanceof AdministratorTokenUnavailableError) {
        await this.recordRejected(
          "administrator_recovery_completed",
          "token_unavailable",
          context
        );
        throw invalidAdministratorTokenError();
      }
      throw error;
    }
  }

  async createBootstrapInvitation(
    identity: AdministratorIdentityInput
  ): Promise<IssuedAdministratorToken> {
    const validated = validateIdentity(identity);
    const token = this.tokens.issueOpaqueToken();
    try {
      const row = await this.repository.createBootstrapInvitation({
        identity: validated,
        tokenHash: token.hash,
        lifetimeSeconds: this.config.invitationLifetimeSeconds,
        audit: this.audit.prepareEvent({
          eventType: "administrator_bootstrap_created",
          outcome: "accepted"
        })
      });
      return { id: row.id, rawToken: token.raw, expiresAt: iso(row.expires_at) };
    } catch (error) {
      if (error instanceof AdministratorBootstrapUnavailableError) {
        throw administratorConflictError(
          "Administrator bootstrap is unavailable after initialization."
        );
      }
      throw error;
    }
  }

  async createLocalRecoveryToken(
    targetAdministratorId: string
  ): Promise<IssuedAdministratorToken> {
    const validatedAdministratorId = validateApplicationUuid(
      targetAdministratorId,
      "administratorId"
    );
    const token = this.tokens.issueOpaqueToken();
    const row = await this.repository.createRecoveryToken({
      targetAdministratorId: validatedAdministratorId,
      tokenHash: token.hash,
      lifetimeSeconds: this.config.recoveryLifetimeSeconds,
      audit: this.audit.prepareEvent({
        eventType: "administrator_local_recovery_created",
        outcome: "accepted"
      })
    });
    return { id: row.id, rawToken: token.raw, expiresAt: iso(row.expires_at) };
  }

  async enforceSensitiveOperatorAction(
    input: SensitiveAdministratorActionInput,
    principal: AdministratorPrincipal,
    context: AdministratorRequestContext
  ): Promise<void> {
    if (!/^[a-z][a-z0-9_.-]{2,79}$/.test(input.action)) {
      throw invalidAdministratorInputError(
        "ADMIN_SENSITIVE_ACTION_INVALID",
        "Sensitive administrator action identifier is invalid."
      );
    }
    await this.enforceRateLimit(
      "sensitive_administrator",
      principal.administratorId,
      this.config.rateLimits.sensitiveActionPerAdministrator,
      input.action,
      context,
      principal
    );
    await this.audit.recordEvent({
      eventType: input.action,
      outcome: "accepted",
      administratorId: principal.administratorId,
      sessionId: principal.sessionId,
      targetType: input.targetType,
      targetId: input.targetId,
      details: { gate: "sensitive_operator_rate_limit" },
      ...context
    });
  }

  private isValidPassword(password: string): boolean {
    return password.length >= this.config.minimumPasswordLength &&
      password.length <= this.config.maximumPasswordLength &&
      Buffer.byteLength(password, "utf8") <= this.config.maximumPasswordLength;
  }

  private requireRecentAuthentication(principal: AdministratorPrincipal): void {
    if (Date.now() - new Date(principal.authenticatedAt).getTime() >
        this.config.recentAuthenticationSeconds * 1_000) {
      throw recentAuthenticationRequiredError();
    }
  }

  private async requireRecentAuthenticationAudited(
    eventType: string,
    principal: AdministratorPrincipal,
    context: AdministratorRequestContext
  ): Promise<void> {
    try {
      this.requireRecentAuthentication(principal);
    } catch (error) {
      await this.recordRejected(
        eventType,
        "recent_authentication_required",
        context,
        principal
      );
      throw error;
    }
  }

  private async enforceRateLimit(
    scope: string,
    subject: string,
    limit: RateLimitConfig,
    eventType: string,
    context: AdministratorRequestContext,
    principal?: AdministratorPrincipal
  ): Promise<void> {
    const decision = await this.repository.consumeRateLimit(
      scope,
      this.tokens.keyedSubjectHash(`rate:${scope}`, subject),
      limit
    );
    if (!decision.allowed) {
      await this.recordRejected(
        eventType,
        "rate_limited",
        context,
        principal
      );
      throw administratorRateLimitedError(decision.retryAfterSeconds);
    }
  }

  private async recordRejected(
    eventType: string,
    reasonCode: string,
    context: AdministratorRequestContext,
    principal?: AdministratorPrincipal
  ): Promise<void> {
    try {
      await this.audit.recordEvent({
        eventType,
        outcome: "rejected",
        reasonCode,
        administratorId: principal?.administratorId,
        sessionId: principal?.sessionId,
        ...context
      });
    } catch {
      // A rejected request remains rejected when audit storage is unavailable.
    }
  }
}

function normalizeLoginName(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function isValidLoginName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(value);
}

function validateIdentity(
  identity: AdministratorIdentityInput | null | undefined
): AdministratorIdentityInput & { normalizedLoginName: string } {
  const loginName = identity?.loginName?.trim() ?? "";
  const displayName = identity?.displayName?.trim().normalize("NFKC") ?? "";
  if (!isValidLoginName(loginName)) {
    throw invalidAdministratorInputError(
      "ADMIN_LOGIN_NAME_INVALID",
      "Login name must contain 3-64 ASCII letters, numbers, dots, dashes, or underscores.",
      "loginName"
    );
  }
  if (displayName.length === 0 || Array.from(displayName).length > 80) {
    throw invalidAdministratorInputError(
      "ADMIN_DISPLAY_NAME_INVALID",
      "Display name must contain between 1 and 80 characters.",
      "displayName"
    );
  }
  return { loginName, normalizedLoginName: normalizeLoginName(loginName), displayName };
}

function validateApplicationUuid(
  value: string | null | undefined,
  path: string
): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw invalidAdministratorInputError(
      "ADMIN_IDENTIFIER_INVALID",
      "Administrator resource identifier is invalid.",
      path
    );
  }
  return normalized;
}

function validatePassword(
  password: string | undefined,
  config: AdministratorAuthConfig
): string {
  const value = password ?? "";
  if (value.length < config.minimumPasswordLength ||
      value.length > config.maximumPasswordLength ||
      Buffer.byteLength(value, "utf8") > config.maximumPasswordLength) {
    throw invalidAdministratorInputError(
      "ADMIN_PASSWORD_LENGTH_INVALID",
      `Password must contain between ${config.minimumPasswordLength} and ${config.maximumPasswordLength} bytes.`,
      "password"
    );
  }
  return value;
}

function validateRawToken(value: string | undefined): string {
  if (value === undefined || !/^[A-Za-z0-9_-]{32,256}$/.test(value)) {
    throw invalidAdministratorTokenError();
  }
  return value;
}

function networkSubject(context: AdministratorRequestContext): string {
  return context.networkIdentity ?? "unavailable-network";
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
