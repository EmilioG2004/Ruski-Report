import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PoolClient, QueryResultRow } from "pg";

import { PostgresDatabase } from "../../database";
import { RateLimitConfig } from "../../config/admin-auth.config";
import {
  AdministratorAuditEvent,
  AdministratorAuditPage,
  AdministratorCredentialRecord,
  AdministratorIdentityInput,
  AdministratorPrincipal,
  PreparedAdministratorSecurityAuditEvent,
  AuthenticatedAdministratorSession
} from "./administrator-security.types";

export class AdministratorTokenUnavailableError extends Error {}
export class AdministratorIdentityConflictError extends Error {}
export class AdministratorBootstrapUnavailableError extends Error {}
export class AdministratorAccountUnavailableError extends Error {}
export class AdministratorAuditCursorError extends Error {}

interface CredentialRow extends QueryResultRow {
  id: string;
  login_name: string;
  normalized_login_name: string;
  display_name: string;
  status: "active" | "disabled";
  credential_version: number;
  password_hash: string;
  hash_algorithm: string;
  hash_version: number;
}

interface SessionRow extends QueryResultRow {
  session_id: string;
  administrator_id: string;
  login_name: string;
  display_name: string;
  authenticated_at: Date | string;
  expires_at: Date | string;
  csrf_token_hash: string;
}

interface TokenRow extends QueryResultRow {
  id: string;
  expires_at: Date | string;
}

interface AuditRow extends QueryResultRow {
  id: string;
  administrator_id: string | null;
  event_type: string;
  outcome: "accepted" | "rejected";
  reason_code: string | null;
  target_type: string | null;
  target_id: string | null;
  occurred_at: Date | string;
  details: Record<string, unknown>;
}

@Injectable()
export class AdministratorSecurityRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async findCredential(
    normalizedLoginName: string
  ): Promise<AdministratorCredentialRecord | null> {
    const result = await this.database.query<CredentialRow>(
      `
        SELECT account.id, account.login_name, account.normalized_login_name,
               account.display_name, account.status,
               account.credential_version, credential.password_hash,
               credential.hash_algorithm, credential.hash_version
        FROM admin_accounts account
        JOIN admin_account_credentials credential
          ON credential.administrator_id = account.id
        WHERE account.normalized_login_name = $1
      `,
      [normalizedLoginName]
    );
    return result.rows[0] === undefined ? null : mapCredential(result.rows[0]);
  }

  async createSession(input: {
    administratorId: string;
    tokenHash: string;
    csrfTokenHash: string;
    sessionLifetimeSeconds: number;
    idleLifetimeSeconds: number;
    replacementPasswordHash?: string;
    audit: PreparedAdministratorSecurityAuditEvent;
  }): Promise<AdministratorPrincipal> {
    return this.inTransaction(async (client) => {
      const account = await client.query<CredentialRow>(
        `
          SELECT account.id, account.login_name, account.normalized_login_name,
                 account.display_name, account.status,
                 account.credential_version, credential.password_hash,
                 credential.hash_algorithm, credential.hash_version
          FROM admin_accounts account
          JOIN admin_account_credentials credential
            ON credential.administrator_id = account.id
          WHERE account.id = $1 AND account.status = 'active'
          FOR UPDATE OF account, credential
        `,
        [input.administratorId]
      );
      if (account.rows[0] === undefined) {
        throw new AdministratorAccountUnavailableError();
      }

      if (input.replacementPasswordHash !== undefined) {
        await client.query(
          `
            UPDATE admin_account_credentials
            SET hash_algorithm = 'scrypt', hash_version = 1,
                password_hash = $2, updated_at = now()
            WHERE administrator_id = $1
          `,
          [input.administratorId, input.replacementPasswordHash]
        );
        await client.query(
          `
            UPDATE admin_accounts
            SET credential_version = credential_version + 1,
                updated_at = now()
            WHERE id = $1
          `,
          [input.administratorId]
        );
      }

      const sessionId = randomUUID();
      const result = await client.query<SessionRow>(
        `
          WITH created AS (
            INSERT INTO admin_sessions (
              id, administrator_id, token_hash, csrf_token_hash,
              authenticated_at, created_at, last_seen_at,
              idle_expires_at, expires_at
            ) VALUES (
              $1, $2, $3, $4, now(), now(), now(),
              now() + make_interval(secs => $5),
              now() + make_interval(secs => $6)
            )
            RETURNING *
          ), touched AS (
            UPDATE admin_accounts
            SET last_authenticated_at = now(), updated_at = now()
            WHERE id = $2
          )
          SELECT created.id AS session_id,
                 created.administrator_id,
                 account.login_name,
                 account.display_name,
                 created.authenticated_at,
                 created.expires_at,
                 created.csrf_token_hash
          FROM created
          JOIN admin_accounts account ON account.id = created.administrator_id
        `,
        [
          sessionId,
          input.administratorId,
          input.tokenHash,
          input.csrfTokenHash,
          input.idleLifetimeSeconds,
          input.sessionLifetimeSeconds
        ]
      );
      const principal = mapPrincipal(requireRow(result.rows[0]));
      await this.insertAuditEvent(client, enrichAudit(input.audit, {
        administratorId: principal.administratorId,
        sessionId: principal.sessionId
      }));
      return principal;
    });
  }

  async authenticateSession(
    tokenHash: string,
    idleLifetimeSeconds: number
  ): Promise<AuthenticatedAdministratorSession | null> {
    const result = await this.database.query<SessionRow>(
      `
        UPDATE admin_sessions session
        SET last_seen_at = now(),
            idle_expires_at = LEAST(
              session.expires_at,
              now() + make_interval(secs => $2)
            )
        FROM admin_accounts account
        WHERE session.token_hash = $1
          AND session.administrator_id = account.id
          AND session.revoked_at IS NULL
          AND session.expires_at > now()
          AND session.idle_expires_at > now()
          AND account.status = 'active'
        RETURNING session.id AS session_id,
                  session.administrator_id,
                  account.login_name,
                  account.display_name,
                  session.authenticated_at,
                  session.expires_at,
                  session.csrf_token_hash
      `,
      [tokenHash, idleLifetimeSeconds]
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { principal: mapPrincipal(row), csrfTokenHash: row.csrf_token_hash };
  }

  async revokeSession(input: {
    sessionId: string;
    administratorId: string;
    reason: string;
    audit: PreparedAdministratorSecurityAuditEvent;
  }): Promise<void> {
    await this.inTransaction(async (client) => {
      await client.query(
        `
          UPDATE admin_sessions
          SET revoked_at = now(), revoke_reason = $2
          WHERE id = $1 AND revoked_at IS NULL
        `,
        [input.sessionId, input.reason]
      );
      await this.insertAuditEvent(client, enrichAudit(input.audit, {
        administratorId: input.administratorId,
        sessionId: input.sessionId
      }));
    });
  }

  async consumeRateLimit(
    scope: string,
    subjectHash: string,
    limit: RateLimitConfig
  ): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
    return this.inTransaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))",
        [scope, subjectHash]
      );
      const current = await client.query<{
        window_started_at: Date | string;
        attempt_count: number;
        blocked_until: Date | string | null;
        now: Date | string;
      }>(
        `
          SELECT bucket.window_started_at, bucket.attempt_count,
                 bucket.blocked_until, now() AS now
          FROM admin_rate_limit_buckets bucket
          WHERE scope = $1 AND subject_hash = $2
          FOR UPDATE
        `,
        [scope, subjectHash]
      );
      const row = current.rows[0];
      if (row === undefined) {
        await client.query(
          `
            INSERT INTO admin_rate_limit_buckets (
              scope, subject_hash, window_started_at, attempt_count, updated_at
            ) VALUES ($1, $2, now(), 1, now())
          `,
          [scope, subjectHash]
        );
        return { allowed: true };
      }

      const now = new Date(row.now);
      const blockedUntil = row.blocked_until === null
        ? null
        : new Date(row.blocked_until);
      if (blockedUntil !== null && blockedUntil > now) {
        return {
          allowed: false,
          retryAfterSeconds: secondsBetween(now, blockedUntil)
        };
      }
      const windowEnds = new Date(
        new Date(row.window_started_at).getTime() + limit.windowSeconds * 1_000
      );
      if (windowEnds <= now) {
        await client.query(
          `
            UPDATE admin_rate_limit_buckets
            SET window_started_at = now(), attempt_count = 1,
                blocked_until = NULL, updated_at = now()
            WHERE scope = $1 AND subject_hash = $2
          `,
          [scope, subjectHash]
        );
        return { allowed: true };
      }
      if (row.attempt_count >= limit.maximumAttempts) {
        await client.query(
          `
            UPDATE admin_rate_limit_buckets
            SET blocked_until = $3, updated_at = now()
            WHERE scope = $1 AND subject_hash = $2
          `,
          [scope, subjectHash, windowEnds.toISOString()]
        );
        return {
          allowed: false,
          retryAfterSeconds: secondsBetween(now, windowEnds)
        };
      }
      await client.query(
        `
          UPDATE admin_rate_limit_buckets
          SET attempt_count = attempt_count + 1, updated_at = now()
          WHERE scope = $1 AND subject_hash = $2
        `,
        [scope, subjectHash]
      );
      return { allowed: true };
    });
  }

  async createInvitation(input: {
    identity: AdministratorIdentityInput & { normalizedLoginName: string };
    tokenHash: string;
    issuerAdministratorId: string;
    lifetimeSeconds: number;
    audit: PreparedAdministratorSecurityAuditEvent;
  }): Promise<TokenRow> {
    return this.inTransaction(async (client) => {
      await this.requireActiveAdministrator(client, input.issuerAdministratorId);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('admin-invitation:' || $1))",
        [input.identity.normalizedLoginName]
      );
      await this.assertLoginAvailable(client, input.identity.normalizedLoginName);
      await client.query(
        `
          UPDATE admin_invitations
          SET revoked_at = now()
          WHERE normalized_login_name = $1
            AND accepted_at IS NULL AND revoked_at IS NULL
        `,
        [input.identity.normalizedLoginName]
      );
      const result = await client.query<TokenRow>(
        `
          INSERT INTO admin_invitations (
            id, kind, login_name, normalized_login_name, display_name,
            token_hash, invited_by_admin_id, created_at, expires_at
          ) VALUES (
            $1, 'standard', $2, $3, $4, $5, $6, now(),
            now() + make_interval(secs => $7)
          )
          RETURNING id, expires_at
        `,
        [
          randomUUID(), input.identity.loginName,
          input.identity.normalizedLoginName, input.identity.displayName,
          input.tokenHash, input.issuerAdministratorId, input.lifetimeSeconds
        ]
      );
      const row = requireRow(result.rows[0]);
      await this.insertAuditEvent(client, enrichAudit(input.audit, {
        administratorId: input.issuerAdministratorId,
        targetType: "administrator_invitation",
        targetId: row.id
      }));
      return row;
    });
  }

  async revokeInvitation(
    input: {
      invitationId: string;
      issuerAdministratorId: string;
      audit: PreparedAdministratorSecurityAuditEvent;
    }
  ): Promise<boolean> {
    return this.inTransaction(async (client) => {
      const result = await client.query(
        `
          UPDATE admin_invitations invitation
          SET revoked_at = now()
          FROM admin_accounts issuer
          WHERE invitation.id = $1
            AND issuer.id = $2 AND issuer.status = 'active'
            AND invitation.accepted_at IS NULL
            AND invitation.revoked_at IS NULL
          RETURNING invitation.id
        `,
        [input.invitationId, input.issuerAdministratorId]
      );
      const revoked = (result.rowCount ?? 0) > 0;
      if (revoked) {
        await this.insertAuditEvent(client, enrichAudit(input.audit, {
          administratorId: input.issuerAdministratorId,
          targetType: "administrator_invitation",
          targetId: input.invitationId
        }));
      }
      return revoked;
    });
  }

  async acceptInvitation(input: {
    tokenHash: string;
    passwordHash: string;
    sessionTokenHash: string;
    csrfTokenHash: string;
    sessionLifetimeSeconds: number;
    idleLifetimeSeconds: number;
    audit: PreparedAdministratorSecurityAuditEvent;
  }): Promise<AdministratorPrincipal> {
    return this.inTransaction(async (client) => {
      const invitationIdentity = await client.query<{
        normalized_login_name: string;
      }>(
        `SELECT normalized_login_name FROM admin_invitations WHERE token_hash = $1`,
        [input.tokenHash]
      );
      const normalizedLoginName = invitationIdentity.rows[0]
        ?.normalized_login_name;
      if (normalizedLoginName === undefined) {
        throw new AdministratorTokenUnavailableError();
      }
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('admin-invitation:' || $1))",
        [normalizedLoginName]
      );
      const invitation = await client.query<{
        id: string;
        login_name: string;
        normalized_login_name: string;
        display_name: string;
        invited_by_admin_id: string | null;
      }>(
        `
          SELECT id, login_name, normalized_login_name, display_name,
                 invited_by_admin_id
          FROM admin_invitations
          WHERE token_hash = $1
            AND accepted_at IS NULL AND revoked_at IS NULL
            AND expires_at > now()
          FOR UPDATE
        `,
        [input.tokenHash]
      );
      const invitationRow = invitation.rows[0];
      if (invitationRow === undefined) {
        throw new AdministratorTokenUnavailableError();
      }
      await this.assertLoginAvailable(client, invitationRow.normalized_login_name);
      const administratorId = randomUUID();
      await client.query(
        `
          INSERT INTO admin_accounts (
            id, login_name, normalized_login_name, display_name,
            created_by_admin_id, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, now(), now())
        `,
        [
          administratorId, invitationRow.login_name,
          invitationRow.normalized_login_name, invitationRow.display_name,
          invitationRow.invited_by_admin_id
        ]
      );
      await client.query(
        `
          INSERT INTO admin_account_credentials (
            administrator_id, hash_algorithm, hash_version,
            password_hash, updated_at
          ) VALUES ($1, 'scrypt', 1, $2, now())
        `,
        [administratorId, input.passwordHash]
      );
      await client.query(
        `
          UPDATE admin_invitations
          SET accepted_at = now(), accepted_by_admin_id = $2
          WHERE id = $1
        `,
        [invitationRow.id, administratorId]
      );
      const principal = await this.insertSession(client, {
        administratorId,
        tokenHash: input.sessionTokenHash,
        csrfTokenHash: input.csrfTokenHash,
        sessionLifetimeSeconds: input.sessionLifetimeSeconds,
        idleLifetimeSeconds: input.idleLifetimeSeconds
      });
      await this.insertAuditEvent(client, enrichAudit(input.audit, {
        administratorId,
        sessionId: principal.sessionId,
        targetType: "administrator_invitation",
        targetId: invitationRow.id
      }));
      return principal;
    });
  }

  async createRecoveryToken(input: {
    targetAdministratorId: string;
    tokenHash: string;
    issuedByAdministratorId?: string;
    lifetimeSeconds: number;
    audit: PreparedAdministratorSecurityAuditEvent;
  }): Promise<TokenRow> {
    return this.inTransaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('admin-recovery:' || $1::text))",
        [input.targetAdministratorId]
      );
      if (input.issuedByAdministratorId !== undefined) {
        await this.requireActiveAdministrator(client, input.issuedByAdministratorId);
      }
      await this.requireActiveAdministrator(client, input.targetAdministratorId);
      await client.query(
        `
          UPDATE admin_recovery_tokens
          SET revoked_at = now()
          WHERE administrator_id = $1
            AND consumed_at IS NULL AND revoked_at IS NULL
        `,
        [input.targetAdministratorId]
      );
      const issuedVia = input.issuedByAdministratorId === undefined
        ? "local_operator"
        : "administrator";
      const result = await client.query<TokenRow>(
        `
          INSERT INTO admin_recovery_tokens (
            id, administrator_id, token_hash, issued_by_admin_id,
            issued_via, created_at, expires_at
          ) VALUES (
            $1, $2, $3, $4, $5, now(),
            now() + make_interval(secs => $6)
          )
          RETURNING id, expires_at
        `,
        [
          randomUUID(), input.targetAdministratorId, input.tokenHash,
          input.issuedByAdministratorId ?? null, issuedVia,
          input.lifetimeSeconds
        ]
      );
      const row = requireRow(result.rows[0]);
      await this.insertAuditEvent(client, enrichAudit(input.audit, {
        administratorId: input.issuedByAdministratorId,
        targetType: "administrator_recovery_token",
        targetId: row.id,
        details: {
          ...input.audit.details,
          targetAdministratorId: input.targetAdministratorId
        }
      }));
      return row;
    });
  }

  async consumeRecoveryToken(
    tokenHash: string,
    passwordHash: string,
    audit: PreparedAdministratorSecurityAuditEvent
  ): Promise<string> {
    return this.inTransaction(async (client) => {
      const tokenIdentity = await client.query<{ administrator_id: string }>(
        `SELECT administrator_id FROM admin_recovery_tokens WHERE token_hash = $1`,
        [tokenHash]
      );
      const targetAdministratorId = tokenIdentity.rows[0]?.administrator_id;
      if (targetAdministratorId === undefined) {
        throw new AdministratorTokenUnavailableError();
      }
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('admin-recovery:' || $1::text))",
        [targetAdministratorId]
      );
      const result = await client.query<{
        id: string;
        administrator_id: string;
      }>(
        `
          SELECT token.id, token.administrator_id
          FROM admin_recovery_tokens token
          JOIN admin_accounts account ON account.id = token.administrator_id
          WHERE token.token_hash = $1
            AND token.consumed_at IS NULL AND token.revoked_at IS NULL
            AND token.expires_at > now() AND account.status = 'active'
          FOR UPDATE OF token, account
        `,
        [tokenHash]
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new AdministratorTokenUnavailableError();
      }
      await client.query(
        `
          UPDATE admin_account_credentials
          SET hash_algorithm = 'scrypt', hash_version = 1,
              password_hash = $2, updated_at = now()
          WHERE administrator_id = $1
        `,
        [row.administrator_id, passwordHash]
      );
      await client.query(
        `
          UPDATE admin_accounts
          SET credential_version = credential_version + 1,
              updated_at = now()
          WHERE id = $1
        `,
        [row.administrator_id]
      );
      await client.query(
        `UPDATE admin_recovery_tokens SET consumed_at = now() WHERE id = $1`,
        [row.id]
      );
      await client.query(
        `
          UPDATE admin_sessions
          SET revoked_at = now(), revoke_reason = 'credential_recovery'
          WHERE administrator_id = $1 AND revoked_at IS NULL
        `,
        [row.administrator_id]
      );
      await this.insertAuditEvent(client, enrichAudit(audit, {
        administratorId: row.administrator_id,
        targetType: "administrator_account",
        targetId: row.administrator_id,
        details: { ...audit.details, recoveryTokenId: row.id }
      }));
      return row.administrator_id;
    });
  }

  async createBootstrapInvitation(input: {
    identity: AdministratorIdentityInput & { normalizedLoginName: string };
    tokenHash: string;
    lifetimeSeconds: number;
    audit: PreparedAdministratorSecurityAuditEvent;
  }): Promise<TokenRow> {
    return this.inTransaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('ruski-report-admin-bootstrap'))"
      );
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM admin_accounts"
      );
      if (Number(count.rows[0]?.count ?? 0) !== 0) {
        throw new AdministratorBootstrapUnavailableError();
      }
      await client.query(
        `
          UPDATE admin_invitations
          SET revoked_at = now()
          WHERE kind = 'bootstrap' AND accepted_at IS NULL
            AND revoked_at IS NULL AND expires_at <= now()
        `
      );
      const pending = await client.query(
        `
          SELECT id FROM admin_invitations
          WHERE kind = 'bootstrap' AND accepted_at IS NULL
            AND revoked_at IS NULL AND expires_at > now()
          FOR UPDATE
        `
      );
      if (pending.rows[0] !== undefined) {
        throw new AdministratorBootstrapUnavailableError();
      }
      const result = await client.query<TokenRow>(
        `
          INSERT INTO admin_invitations (
            id, kind, login_name, normalized_login_name, display_name,
            token_hash, created_at, expires_at
          ) VALUES (
            $1, 'bootstrap', $2, $3, $4, $5, now(),
            now() + make_interval(secs => $6)
          )
          RETURNING id, expires_at
        `,
        [
          randomUUID(), input.identity.loginName,
          input.identity.normalizedLoginName, input.identity.displayName,
          input.tokenHash, input.lifetimeSeconds
        ]
      );
      const row = requireRow(result.rows[0]);
      await this.insertAuditEvent(client, enrichAudit(input.audit, {
        targetType: "administrator_invitation",
        targetId: row.id
      }));
      return row;
    });
  }

  async recordAuditEvent(
    input: PreparedAdministratorSecurityAuditEvent
  ): Promise<void> {
    await this.database.query(...auditInsertQuery(input));
  }

  private async insertAuditEvent(
    client: PoolClient,
    input: PreparedAdministratorSecurityAuditEvent
  ): Promise<void> {
    await client.query(...auditInsertQuery(input));
  }

  async listAuditEvents(limit: number, before?: string): Promise<AdministratorAuditPage> {
    const cursor = before === undefined ? undefined : parseAuditCursor(before);
    const result = await this.database.query<AuditRow>(
      `
        SELECT id, administrator_id, event_type, outcome, reason_code,
               target_type, target_id, occurred_at, details
        FROM admin_security_audit_events
        WHERE (
          $2::timestamptz IS NULL
          OR (occurred_at, id) < ($2::timestamptz, $3::uuid)
        )
        ORDER BY occurred_at DESC, id DESC
        LIMIT $1
      `,
      [limit + 1, cursor?.occurredAt ?? null, cursor?.id ?? null]
    );
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    return {
      events: rows.map(mapAuditEvent),
      ...(hasMore && rows.length > 0
        ? { nextCursor: createAuditCursor(rows[rows.length - 1]) }
        : {})
    };
  }

  private async insertSession(
    client: PoolClient,
    input: {
      administratorId: string;
      tokenHash: string;
      csrfTokenHash: string;
      sessionLifetimeSeconds: number;
      idleLifetimeSeconds: number;
    }
  ): Promise<AdministratorPrincipal> {
    const result = await client.query<SessionRow>(
      `
        WITH created AS (
          INSERT INTO admin_sessions (
            id, administrator_id, token_hash, csrf_token_hash,
            authenticated_at, created_at, last_seen_at,
            idle_expires_at, expires_at
          ) VALUES (
            $1, $2, $3, $4, now(), now(), now(),
            now() + make_interval(secs => $5),
            now() + make_interval(secs => $6)
          )
          RETURNING *
        )
        SELECT created.id AS session_id, created.administrator_id,
               account.login_name, account.display_name,
               created.authenticated_at, created.expires_at,
               created.csrf_token_hash
        FROM created
        JOIN admin_accounts account ON account.id = created.administrator_id
      `,
      [
        randomUUID(), input.administratorId, input.tokenHash,
        input.csrfTokenHash, input.idleLifetimeSeconds,
        input.sessionLifetimeSeconds
      ]
    );
    await client.query(
      `
        UPDATE admin_accounts
        SET last_authenticated_at = now(), updated_at = now()
        WHERE id = $1
      `,
      [input.administratorId]
    );
    return mapPrincipal(requireRow(result.rows[0]));
  }

  private async requireActiveAdministrator(
    client: PoolClient,
    administratorId: string
  ): Promise<void> {
    const result = await client.query(
      `SELECT id FROM admin_accounts WHERE id = $1 AND status = 'active' FOR SHARE`,
      [administratorId]
    );
    if (result.rows[0] === undefined) {
      throw new AdministratorAccountUnavailableError();
    }
  }

  private async assertLoginAvailable(
    client: PoolClient,
    normalizedLoginName: string
  ): Promise<void> {
    const result = await client.query(
      "SELECT id FROM admin_accounts WHERE normalized_login_name = $1 FOR KEY SHARE",
      [normalizedLoginName]
    );
    if (result.rows[0] !== undefined) {
      throw new AdministratorIdentityConflictError();
    }
  }

  private async inTransaction<T>(
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapCredential(row: CredentialRow): AdministratorCredentialRecord {
  return {
    administratorId: row.id,
    loginName: row.login_name,
    normalizedLoginName: row.normalized_login_name,
    displayName: row.display_name,
    status: row.status,
    credentialVersion: Number(row.credential_version),
    passwordHash: row.password_hash,
    hashAlgorithm: row.hash_algorithm,
    hashVersion: Number(row.hash_version)
  };
}

function mapPrincipal(row: SessionRow): AdministratorPrincipal {
  return {
    administratorId: row.administrator_id,
    loginName: row.login_name,
    displayName: row.display_name,
    sessionId: row.session_id,
    authenticatedAt: toISOString(row.authenticated_at),
    expiresAt: toISOString(row.expires_at)
  };
}

function mapAuditEvent(row: AuditRow): AdministratorAuditEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    outcome: row.outcome,
    ...(row.administrator_id === null
      ? {}
      : { administratorId: row.administrator_id }),
    ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
    ...(row.target_type === null ? {} : { targetType: row.target_type }),
    ...(row.target_id === null ? {} : { targetId: row.target_id }),
    occurredAt: toISOString(row.occurred_at),
    details: row.details
  };
}

function requireRow<Row>(row: Row | undefined): Row {
  if (row === undefined) {
    throw new Error("Administrator persistence did not return the expected row.");
  }
  return row;
}

function enrichAudit(
  input: PreparedAdministratorSecurityAuditEvent,
  generated: Partial<PreparedAdministratorSecurityAuditEvent>
): PreparedAdministratorSecurityAuditEvent {
  return { ...input, ...generated };
}

function auditInsertQuery(
  input: PreparedAdministratorSecurityAuditEvent
): [string, unknown[]] {
  return [
    `
      INSERT INTO admin_security_audit_events (
        id, administrator_id, session_id, legacy_operator_id,
        event_type, outcome, reason_code, target_type, target_id,
        request_id, correlation_id, network_key_hash, user_agent_hash,
        occurred_at, details
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, now(), $14::jsonb
      )
    `,
    [
      randomUUID(), input.administratorId ?? null, input.sessionId ?? null,
      input.legacyOperatorId ?? null, input.eventType, input.outcome,
      input.reasonCode ?? null, input.targetType ?? null,
      input.targetId ?? null, input.requestId ?? null,
      input.correlationId ?? null, input.networkKeyHash ?? null,
      input.userAgentHash ?? null, JSON.stringify(input.details)
    ]
  ];
}

function toISOString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function secondsBetween(first: Date, second: Date): number {
  return Math.max(1, Math.ceil((second.getTime() - first.getTime()) / 1_000));
}

function createAuditCursor(row: AuditRow): string {
  return Buffer.from(JSON.stringify({
    occurredAt: toISOString(row.occurred_at),
    id: row.id
  }), "utf8").toString("base64url");
}

function parseAuditCursor(value: string): { occurredAt: string; id: string } {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as { occurredAt?: unknown; id?: unknown };
    if (typeof decoded.occurredAt !== "string" ||
        Number.isNaN(new Date(decoded.occurredAt).getTime()) ||
        typeof decoded.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded.id)) {
      throw new Error("invalid cursor");
    }
    return { occurredAt: new Date(decoded.occurredAt).toISOString(), id: decoded.id };
  } catch {
    throw new AdministratorAuditCursorError();
  }
}
