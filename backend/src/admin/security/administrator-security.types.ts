export interface AdministratorPrincipal {
  administratorId: string;
  loginName: string;
  displayName: string;
  sessionId: string;
  authenticatedAt: string;
  expiresAt: string;
}

export interface AdministratorCredentialRecord {
  administratorId: string;
  loginName: string;
  normalizedLoginName: string;
  displayName: string;
  status: "active" | "disabled";
  credentialVersion: number;
  passwordHash: string;
  hashAlgorithm: string;
  hashVersion: number;
}

export interface AuthenticatedAdministratorSession {
  principal: AdministratorPrincipal;
  csrfTokenHash: string;
}

export interface AdministratorRequestContext {
  requestId?: string;
  networkIdentity?: string;
  userAgent?: string;
}

export interface AdministratorSecurityAuditEventInput
  extends AdministratorRequestContext {
  eventType: string;
  outcome: "accepted" | "rejected";
  administratorId?: string;
  sessionId?: string;
  legacyOperatorId?: string;
  reasonCode?: string;
  targetType?: string;
  targetId?: string;
  correlationId?: string;
  details?: Record<string, unknown>;
}

export interface PreparedAdministratorSecurityAuditEvent {
  eventType: string;
  outcome: "accepted" | "rejected";
  administratorId?: string;
  sessionId?: string;
  legacyOperatorId?: string;
  reasonCode?: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  correlationId?: string;
  networkKeyHash?: string;
  userAgentHash?: string;
  details: Record<string, unknown>;
}

export interface IssuedAdministratorSession {
  principal: AdministratorPrincipal;
  rawSessionToken: string;
  rawCsrfToken: string;
}

export interface IssuedAdministratorToken {
  id: string;
  rawToken: string;
  expiresAt: string;
}

export interface AdministratorIdentityInput {
  loginName: string;
  displayName: string;
}

export interface AdministratorAuditPage {
  events: readonly AdministratorAuditEvent[];
  nextCursor?: string;
}

export interface AdministratorAuditEvent {
  id: string;
  eventType: string;
  outcome: "accepted" | "rejected";
  administratorId?: string;
  reasonCode?: string;
  targetType?: string;
  targetId?: string;
  occurredAt: string;
  details: Record<string, unknown>;
}
