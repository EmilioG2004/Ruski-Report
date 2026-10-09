export const ADMIN_AUTH_CONFIG = Symbol("ADMIN_AUTH_CONFIG");

export interface AdministratorAuthConfig {
  origin: string;
  production: boolean;
  secureCookies: boolean;
  sessionCookieName: string;
  csrfCookieName: string;
  preAuthCsrfCookieName: string;
  securitySecret: string;
  minimumPasswordLength: number;
  maximumPasswordLength: number;
  sessionLifetimeSeconds: number;
  sessionIdleLifetimeSeconds: number;
  preAuthCsrfLifetimeSeconds: number;
  invitationLifetimeSeconds: number;
  recoveryLifetimeSeconds: number;
  recentAuthenticationSeconds: number;
  sessionTokenLength: number;
  passwordHash: {
    cost: number;
    blockSize: number;
    parallelization: number;
    keyLength: number;
    saltLength: number;
  };
  rateLimits: {
    preAuthPerNetwork: RateLimitConfig;
    loginPerNetwork: RateLimitConfig;
    loginPerIdentityAndNetwork: RateLimitConfig;
    tokenUsePerNetwork: RateLimitConfig;
    sensitiveActionPerAdministrator: RateLimitConfig;
  };
}

export interface RateLimitConfig {
  maximumAttempts: number;
  windowSeconds: number;
}

const DEVELOPMENT_SECURITY_SECRET =
  "development-only-administrator-security-secret-change-me";

export function loadAdministratorAuthConfig(
  environment: NodeJS.ProcessEnv = process.env
): AdministratorAuthConfig {
  const production = environment.NODE_ENV === "production";
  const secureCookies = readBoolean(
    environment.ADMIN_AUTH_SECURE_COOKIES,
    production
  );
  const origin = normalizeOrigin(
    environment.ADMIN_WEB_ORIGIN ?? "http://localhost:3000"
  );
  const securitySecret =
    environment.ADMIN_AUTH_SECURITY_SECRET?.trim() ||
    DEVELOPMENT_SECURITY_SECRET;

  if (production && !secureCookies) {
    throw new Error(
      "ADMIN_AUTH_SECURE_COOKIES cannot be disabled in production."
    );
  }
  if (production && !origin.startsWith("https://")) {
    throw new Error("ADMIN_WEB_ORIGIN must use HTTPS in production.");
  }
  if (production && securitySecret === DEVELOPMENT_SECURITY_SECRET) {
    throw new Error("ADMIN_AUTH_SECURITY_SECRET is required in production.");
  }
  if (Buffer.byteLength(securitySecret, "utf8") < 32) {
    throw new Error("ADMIN_AUTH_SECURITY_SECRET must contain at least 32 bytes.");
  }

  const config: AdministratorAuthConfig = {
    origin,
    production,
    secureCookies,
    sessionCookieName: secureCookies
      ? "__Host-ruski_admin_session"
      : "ruski_admin_session",
    csrfCookieName: secureCookies
      ? "__Host-ruski_admin_csrf"
      : "ruski_admin_csrf",
    preAuthCsrfCookieName: secureCookies
      ? "__Host-ruski_admin_preauth_csrf"
      : "ruski_admin_preauth_csrf",
    securitySecret,
    minimumPasswordLength: positiveInteger(
      environment.ADMIN_AUTH_MIN_PASSWORD_LENGTH,
      12,
      "ADMIN_AUTH_MIN_PASSWORD_LENGTH"
    ),
    maximumPasswordLength: positiveInteger(
      environment.ADMIN_AUTH_MAX_PASSWORD_LENGTH,
      128,
      "ADMIN_AUTH_MAX_PASSWORD_LENGTH"
    ),
    sessionLifetimeSeconds: positiveInteger(
      environment.ADMIN_AUTH_SESSION_LIFETIME_SECONDS,
      12 * 60 * 60,
      "ADMIN_AUTH_SESSION_LIFETIME_SECONDS"
    ),
    sessionIdleLifetimeSeconds: positiveInteger(
      environment.ADMIN_AUTH_SESSION_IDLE_SECONDS,
      2 * 60 * 60,
      "ADMIN_AUTH_SESSION_IDLE_SECONDS"
    ),
    preAuthCsrfLifetimeSeconds: positiveInteger(
      environment.ADMIN_AUTH_PREAUTH_CSRF_LIFETIME_SECONDS,
      15 * 60,
      "ADMIN_AUTH_PREAUTH_CSRF_LIFETIME_SECONDS"
    ),
    invitationLifetimeSeconds: positiveInteger(
      environment.ADMIN_AUTH_INVITATION_LIFETIME_SECONDS,
      24 * 60 * 60,
      "ADMIN_AUTH_INVITATION_LIFETIME_SECONDS"
    ),
    recoveryLifetimeSeconds: positiveInteger(
      environment.ADMIN_AUTH_RECOVERY_LIFETIME_SECONDS,
      30 * 60,
      "ADMIN_AUTH_RECOVERY_LIFETIME_SECONDS"
    ),
    recentAuthenticationSeconds: positiveInteger(
      environment.ADMIN_AUTH_RECENT_SECONDS,
      15 * 60,
      "ADMIN_AUTH_RECENT_SECONDS"
    ),
    sessionTokenLength: positiveInteger(
      environment.ADMIN_AUTH_SESSION_TOKEN_LENGTH,
      32,
      "ADMIN_AUTH_SESSION_TOKEN_LENGTH"
    ),
    passwordHash: {
      cost: positiveInteger(
        environment.ADMIN_AUTH_SCRYPT_COST,
        16_384,
        "ADMIN_AUTH_SCRYPT_COST"
      ),
      blockSize: positiveInteger(
        environment.ADMIN_AUTH_SCRYPT_BLOCK_SIZE,
        8,
        "ADMIN_AUTH_SCRYPT_BLOCK_SIZE"
      ),
      parallelization: positiveInteger(
        environment.ADMIN_AUTH_SCRYPT_PARALLELIZATION,
        1,
        "ADMIN_AUTH_SCRYPT_PARALLELIZATION"
      ),
      keyLength: positiveInteger(
        environment.ADMIN_AUTH_SCRYPT_KEY_LENGTH,
        64,
        "ADMIN_AUTH_SCRYPT_KEY_LENGTH"
      ),
      saltLength: positiveInteger(
        environment.ADMIN_AUTH_SCRYPT_SALT_LENGTH,
        16,
        "ADMIN_AUTH_SCRYPT_SALT_LENGTH"
      )
    },
    rateLimits: {
      preAuthPerNetwork: rateLimit(environment, "PREAUTH_NETWORK", 60, 600),
      loginPerNetwork: rateLimit(environment, "LOGIN_NETWORK", 20, 900),
      loginPerIdentityAndNetwork: rateLimit(
        environment,
        "LOGIN_IDENTITY_NETWORK",
        5,
        900
      ),
      tokenUsePerNetwork: rateLimit(environment, "TOKEN_NETWORK", 10, 900),
      sensitiveActionPerAdministrator: rateLimit(
        environment,
        "SENSITIVE_ADMIN",
        10,
        3600
      )
    }
  };

  validate(config);
  return config;
}

function validate(config: AdministratorAuthConfig): void {
  if (config.minimumPasswordLength > config.maximumPasswordLength) {
    throw new Error(
      "ADMIN_AUTH_MIN_PASSWORD_LENGTH cannot exceed ADMIN_AUTH_MAX_PASSWORD_LENGTH."
    );
  }
  if (config.sessionIdleLifetimeSeconds > config.sessionLifetimeSeconds) {
    throw new Error(
      "ADMIN_AUTH_SESSION_IDLE_SECONDS cannot exceed the session lifetime."
    );
  }
  const cost = config.passwordHash.cost;
  if (cost < 2 || cost > 1_048_576 || (cost & (cost - 1)) !== 0) {
    throw new Error(
      "ADMIN_AUTH_SCRYPT_COST must be a power of two between 2 and 1048576."
    );
  }
  if (config.passwordHash.blockSize > 32 ||
      config.passwordHash.parallelization > 16 ||
      config.passwordHash.keyLength < 16 ||
      config.passwordHash.keyLength > 128 ||
      config.passwordHash.saltLength < 16 ||
      config.passwordHash.saltLength > 128) {
    throw new Error("Administrator scrypt dimensions are outside safe bounds.");
  }
  if (config.sessionTokenLength < 32 || config.sessionTokenLength > 128) {
    throw new Error(
      "ADMIN_AUTH_SESSION_TOKEN_LENGTH must be between 32 and 128 bytes."
    );
  }
}

function rateLimit(
  environment: NodeJS.ProcessEnv,
  prefix: string,
  attempts: number,
  seconds: number
): RateLimitConfig {
  return {
    maximumAttempts: positiveInteger(
      environment[`ADMIN_AUTH_${prefix}_MAX`],
      attempts,
      `ADMIN_AUTH_${prefix}_MAX`
    ),
    windowSeconds: positiveInteger(
      environment[`ADMIN_AUTH_${prefix}_WINDOW_SECONDS`],
      seconds,
      `ADMIN_AUTH_${prefix}_WINDOW_SECONDS`
    )
  };
}

function normalizeOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("ADMIN_WEB_ORIGIN must be an exact HTTP or HTTPS origin.");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error("ADMIN_WEB_ORIGIN must be an exact HTTP or HTTPS origin.");
  }
  return parsed.origin;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`Expected boolean environment value, received '${value}'.`);
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
