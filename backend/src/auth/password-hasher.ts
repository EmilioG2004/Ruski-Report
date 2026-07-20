import { Inject, Injectable } from "@nestjs/common";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { AUTH_CONFIG, AuthConfig } from "../config/auth.config";

export const PASSWORD_HASHER = Symbol("PASSWORD_HASHER");

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<boolean>;
}

@Injectable()
export class ScryptPasswordHasher implements PasswordHasher {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

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
      ...this.config.passwordHash,
      cost: parsed.cost,
      blockSize: parsed.blockSize,
      parallelization: parsed.parallelization,
      keyLength: parsed.hash.length
    });

    return timingSafeEqual(derivedKey, parsed.hash);
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
    scrypt(
      password,
      salt,
      options.keyLength,
      {
        N: options.cost,
        r: options.blockSize,
        p: options.parallelization,
        maxmem: Math.max(
          32 * 1024 * 1024,
          256 * options.cost * options.blockSize
        )
      },
      (error, derivedKey) => {
        if (error === null) {
          resolve(derivedKey);
        } else {
          reject(error);
        }
      }
    );
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
  const [algorithm, version, cost, blockSize, parallelization, salt, hash] = parts;
  const values = [cost, blockSize, parallelization].map(Number);
  const saltBuffer = Buffer.from(salt ?? "", "base64url");
  const hashBuffer = Buffer.from(hash ?? "", "base64url");

  if (
    parts.length !== 7 ||
    algorithm !== "scrypt" ||
    version !== "1" ||
    values.some((value) => !Number.isSafeInteger(value) || value <= 0) ||
    values[0] > 1_048_576 ||
    (values[0] & (values[0] - 1)) !== 0 ||
    values[1] > 32 ||
    values[2] > 16 ||
    saltBuffer.length === 0 ||
    hashBuffer.length < 16 ||
    hashBuffer.length > 128
  ) {
    return null;
  }

  return {
    cost: values[0],
    blockSize: values[1],
    parallelization: values[2],
    salt: saltBuffer,
    hash: hashBuffer
  };
}
