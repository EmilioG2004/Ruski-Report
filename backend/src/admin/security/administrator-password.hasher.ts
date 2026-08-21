import { Inject, Injectable } from "@nestjs/common";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import {
  ADMIN_AUTH_CONFIG,
  AdministratorAuthConfig
} from "../../config/admin-auth.config";

@Injectable()
export class AdministratorPasswordHasher {
  constructor(
    @Inject(ADMIN_AUTH_CONFIG)
    private readonly config: AdministratorAuthConfig
  ) {}

  async hash(password: string): Promise<string> {
    const options = this.config.passwordHash;
    const salt = randomBytes(options.saltLength);
    const derivedKey = await deriveKey(password, salt, options);
    return [
      "scrypt",
      "1",
      options.cost,
      options.blockSize,
      options.parallelization,
      salt.toString("base64url"),
      derivedKey.toString("base64url")
    ].join("$");
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    const parsed = parseHash(encodedHash);
    if (parsed === null) {
      return false;
    }
    const derivedKey = await deriveKey(password, parsed.salt, {
      cost: parsed.cost,
      blockSize: parsed.blockSize,
      parallelization: parsed.parallelization,
      keyLength: parsed.hash.length
    });
    return timingSafeEqual(derivedKey, parsed.hash);
  }

  needsRehash(encodedHash: string): boolean {
    const parsed = parseHash(encodedHash);
    const configured = this.config.passwordHash;
    return parsed === null ||
      parsed.cost !== configured.cost ||
      parsed.blockSize !== configured.blockSize ||
      parsed.parallelization !== configured.parallelization ||
      parsed.hash.length !== configured.keyLength ||
      parsed.salt.length !== configured.saltLength;
  }
}

interface ScryptOptions {
  cost: number;
  blockSize: number;
  parallelization: number;
  keyLength: number;
}

function deriveKey(
  password: string,
  salt: Buffer,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, options.keyLength, {
      N: options.cost,
      r: options.blockSize,
      p: options.parallelization,
      maxmem: Math.max(32 * 1024 * 1024, 256 * options.cost * options.blockSize)
    }, (error, key) => error === null ? resolve(key) : reject(error));
  });
}

function parseHash(encodedHash: string): {
  cost: number;
  blockSize: number;
  parallelization: number;
  salt: Buffer;
  hash: Buffer;
} | null {
  const parts = encodedHash.split("$");
  const values = parts.slice(2, 5).map(Number);
  if (!/^[A-Za-z0-9_-]+$/.test(parts[5] ?? "") ||
      !/^[A-Za-z0-9_-]+$/.test(parts[6] ?? "")) {
    return null;
  }
  const salt = Buffer.from(parts[5] ?? "", "base64url");
  const hash = Buffer.from(parts[6] ?? "", "base64url");
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== "1" ||
      values.some((value) => !Number.isSafeInteger(value) || value <= 0) ||
      values[0] > 1_048_576 || (values[0] & (values[0] - 1)) !== 0 ||
      values[1] > 32 || values[2] > 16 || salt.length === 0 ||
      hash.length < 16 || hash.length > 128) {
    return null;
  }
  return {
    cost: values[0],
    blockSize: values[1],
    parallelization: values[2],
    salt,
    hash
  };
}
