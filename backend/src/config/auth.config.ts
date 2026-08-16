export const AUTH_CONFIG = Symbol("AUTH_CONFIG");

export interface AuthConfig {
  maximumDisplayNameLength: number;
  minimumPasswordLength: number;
  maximumPasswordLength: number;
  sessionLifetimeSeconds: number;
  passwordHash: {
    cost: number;
    blockSize: number;
    parallelization: number;
    keyLength: number;
    saltLength: number;
  };
  sessionTokenLength: number;
}

export function loadAuthConfig(
  environment: NodeJS.ProcessEnv = process.env
): AuthConfig {
  const config: AuthConfig = {
    maximumDisplayNameLength: positiveInteger(
      environment.AUTH_MAX_DISPLAY_NAME_LENGTH,
      40,
      "AUTH_MAX_DISPLAY_NAME_LENGTH"
    ),
    minimumPasswordLength: positiveInteger(
      environment.AUTH_MIN_PASSWORD_LENGTH,
      10,
      "AUTH_MIN_PASSWORD_LENGTH"
    ),
    maximumPasswordLength: positiveInteger(
      environment.AUTH_MAX_PASSWORD_LENGTH,
      128,
      "AUTH_MAX_PASSWORD_LENGTH"
    ),
    sessionLifetimeSeconds: positiveInteger(
      environment.AUTH_SESSION_LIFETIME_SECONDS,
      60 * 60 * 24 * 30,
      "AUTH_SESSION_LIFETIME_SECONDS"
    ),
    passwordHash: {
      cost: positiveInteger(
        environment.AUTH_SCRYPT_COST,
        16_384,
        "AUTH_SCRYPT_COST"
      ),
      blockSize: positiveInteger(
        environment.AUTH_SCRYPT_BLOCK_SIZE,
        8,
        "AUTH_SCRYPT_BLOCK_SIZE"
      ),
      parallelization: positiveInteger(
        environment.AUTH_SCRYPT_PARALLELIZATION,
        1,
        "AUTH_SCRYPT_PARALLELIZATION"
      ),
      keyLength: positiveInteger(
        environment.AUTH_SCRYPT_KEY_LENGTH,
        64,
        "AUTH_SCRYPT_KEY_LENGTH"
      ),
      saltLength: positiveInteger(
        environment.AUTH_SCRYPT_SALT_LENGTH,
        16,
        "AUTH_SCRYPT_SALT_LENGTH"
      )
    },
    sessionTokenLength: positiveInteger(
      environment.AUTH_SESSION_TOKEN_LENGTH,
      32,
      "AUTH_SESSION_TOKEN_LENGTH"
    )
  };

  validateAuthConfig(config);
  return config;
}

function validateAuthConfig(config: AuthConfig): void {
  if (config.minimumPasswordLength > config.maximumPasswordLength) {
    throw new Error(
      "AUTH_MIN_PASSWORD_LENGTH cannot exceed AUTH_MAX_PASSWORD_LENGTH."
    );
  }

  const cost = config.passwordHash.cost;
  if (cost < 2 || cost > 1_048_576 || (cost & (cost - 1)) !== 0) {
    throw new Error(
      "AUTH_SCRYPT_COST must be a power of two between 2 and 1048576."
    );
  }
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}
