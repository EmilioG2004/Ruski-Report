import { Inject, Injectable } from "@nestjs/common";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

import {
  ADMIN_AUTH_CONFIG,
  AdministratorAuthConfig
} from "../../config/admin-auth.config";

export interface HashedOpaqueToken {
  raw: string;
  hash: string;
}

@Injectable()
export class AdministratorSecurityTokens {
  constructor(
    @Inject(ADMIN_AUTH_CONFIG)
    private readonly config: AdministratorAuthConfig
  ) {}

  issueOpaqueToken(length = this.config.sessionTokenLength): HashedOpaqueToken {
    const raw = randomBytes(length).toString("base64url");
    return { raw, hash: this.hashOpaqueToken(raw) };
  }

  hashOpaqueToken(raw: string): string {
    return createHash("sha256").update(raw, "utf8").digest("hex");
  }

  keyedSubjectHash(scope: string, value: string): string {
    return createHmac("sha256", this.config.securitySecret)
      .update(`ruski-admin:${scope}:`, "utf8")
      .update(value, "utf8")
      .digest("hex");
  }

  issuePreAuthCsrf(now = new Date()): { token: string; expiresAt: string } {
    const expiresAt = new Date(
      now.getTime() + this.config.preAuthCsrfLifetimeSeconds * 1_000
    );
    const payload = [
      "v1",
      String(Math.floor(expiresAt.getTime() / 1_000)),
      randomBytes(24).toString("base64url")
    ].join(".");
    const signature = this.signPreAuthPayload(payload);
    return { token: `${payload}.${signature}`, expiresAt: expiresAt.toISOString() };
  }

  verifyPreAuthCsrf(token: string, now = new Date()): boolean {
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") {
      return false;
    }
    const expiresAtSeconds = Number(parts[1]);
    if (!Number.isSafeInteger(expiresAtSeconds) ||
        expiresAtSeconds <= Math.floor(now.getTime() / 1_000)) {
      return false;
    }
    const payload = parts.slice(0, 3).join(".");
    return safeStringEqual(parts[3], this.signPreAuthPayload(payload));
  }

  matches(first: string, second: string): boolean {
    return safeStringEqual(first, second);
  }

  private signPreAuthPayload(payload: string): string {
    return createHmac("sha256", this.config.securitySecret)
      .update("ruski-admin:preauth-csrf:", "utf8")
      .update(payload, "utf8")
      .digest("base64url");
  }
}

function safeStringEqual(first: string, second: string): boolean {
  const firstBuffer = Buffer.from(first, "utf8");
  const secondBuffer = Buffer.from(second, "utf8");
  return firstBuffer.length === secondBuffer.length &&
    timingSafeEqual(firstBuffer, secondBuffer);
}
