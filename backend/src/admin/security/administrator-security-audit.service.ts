import { Injectable } from "@nestjs/common";

import { AdministratorSecurityRepository } from "./administrator-security.repository";
import { AdministratorAuditCursorError } from "./administrator-security.repository";
import { invalidAdministratorInputError } from "./administrator-security.errors";
import {
  AdministratorAuditPage,
  AdministratorSecurityAuditEventInput,
  PreparedAdministratorSecurityAuditEvent
} from "./administrator-security.types";
import { AdministratorSecurityTokens } from "./administrator-security.tokens";

const SENSITIVE_KEY =
  /password|token|cookie|csrf|secret|authorization|workbook|requestbody|body/i;

@Injectable()
export class AdministratorSecurityAuditService {
  constructor(
    private readonly repository: AdministratorSecurityRepository,
    private readonly tokens: AdministratorSecurityTokens
  ) {}

  recordEvent(input: AdministratorSecurityAuditEventInput): Promise<void> {
    return this.repository.recordAuditEvent(this.prepareEvent(input));
  }

  prepareEvent(
    input: AdministratorSecurityAuditEventInput
  ): PreparedAdministratorSecurityAuditEvent {
    const {
      networkIdentity,
      userAgent,
      ...persisted
    } = input;
    return {
      ...persisted,
      details: sanitizeDetails(input.details ?? {}),
      ...(networkIdentity === undefined
        ? {}
        : {
            networkKeyHash: this.tokens.keyedSubjectHash(
              "audit-network",
              networkIdentity
            )
          }),
      ...(userAgent === undefined
        ? {}
        : {
            userAgentHash: this.tokens.keyedSubjectHash(
              "audit-user-agent",
              userAgent
            )
          })
    };
  }

  async listEvents(limit = 50, before?: string): Promise<AdministratorAuditPage> {
    const safeLimit = Number.isSafeInteger(limit)
      ? Math.min(100, Math.max(1, limit))
      : 50;
    try {
      return await this.repository.listAuditEvents(safeLimit, before);
    } catch (error) {
      if (error instanceof AdministratorAuditCursorError) {
        throw invalidAdministratorInputError(
          "ADMIN_AUDIT_CURSOR_INVALID",
          "Administrator audit cursor is invalid.",
          "before"
        );
      }
      throw error;
    }
  }
}

function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).flatMap(([key, value]) => {
      if (SENSITIVE_KEY.test(key)) {
        return [];
      }
      const sanitized = sanitizeValue(value, 0);
      return sanitized === undefined ? [] : [[key, sanitized]];
    })
  );
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 3 || value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === "boolean" ||
      typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return value.slice(0, 500);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    return sanitizeDetailsAtDepth(value as Record<string, unknown>, depth + 1);
  }
  return undefined;
}

function sanitizeDetailsAtDepth(
  value: Record<string, unknown>,
  depth: number
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).slice(0, 30).flatMap(([key, item]) => {
      if (SENSITIVE_KEY.test(key)) {
        return [];
      }
      const sanitized = sanitizeValue(item, depth);
      return sanitized === undefined ? [] : [[key, sanitized]];
    })
  );
}
