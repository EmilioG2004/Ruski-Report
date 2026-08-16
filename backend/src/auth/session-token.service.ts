import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";

import { AUTH_CONFIG, AuthConfig } from "../config/auth.config";

export interface IssuedSessionToken {
  raw: string;
  hash: string;
}

@Injectable()
export class SessionTokenService {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  issue(): IssuedSessionToken {
    const raw = randomBytes(this.config.sessionTokenLength).toString("base64url");
    return { raw, hash: this.hash(raw) };
  }

  hash(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }
}
