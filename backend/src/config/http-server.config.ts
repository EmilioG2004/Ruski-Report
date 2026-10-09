export interface HttpServerConfig {
  allowedOrigins: string[];
  trustedProxyHops: number;
  requestBodyLimitBytes: number;
  urlEncodedParameterLimit: number;
  scorebookUploadLimitBytes: number;
}

const DEFAULT_REQUEST_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
const DEFAULT_URL_ENCODED_PARAMETER_LIMIT = 7_000;
const DEFAULT_SCOREBOOK_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;

export function loadHttpServerConfig(
  environment: NodeJS.ProcessEnv = process.env
): HttpServerConfig {
  return {
    allowedOrigins: readAllowedOrigins(environment.CORS_ALLOWED_ORIGINS),
    trustedProxyHops: readIntegerInRange(
      environment.HTTP_TRUST_PROXY_HOPS,
      0,
      0,
      10,
      "HTTP_TRUST_PROXY_HOPS"
    ),
    requestBodyLimitBytes: readIntegerInRange(
      environment.HTTP_REQUEST_BODY_LIMIT_BYTES,
      DEFAULT_REQUEST_BODY_LIMIT_BYTES,
      1,
      10 * 1024 * 1024,
      "HTTP_REQUEST_BODY_LIMIT_BYTES"
    ),
    urlEncodedParameterLimit: readIntegerInRange(
      environment.HTTP_URLENCODED_PARAMETER_LIMIT,
      DEFAULT_URL_ENCODED_PARAMETER_LIMIT,
      100,
      10_000,
      "HTTP_URLENCODED_PARAMETER_LIMIT"
    ),
    scorebookUploadLimitBytes: readIntegerInRange(
      environment.SCOREBOOK_UPLOAD_LIMIT_BYTES,
      DEFAULT_SCOREBOOK_UPLOAD_LIMIT_BYTES,
      1,
      50 * 1024 * 1024,
      "SCOREBOOK_UPLOAD_LIMIT_BYTES"
    )
  };
}

export function createCorsOptions(allowedOrigins: readonly string[]): {
  origin: string[];
  methods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
  credentials: boolean;
  maxAge: number;
} {
  return {
    origin: [...allowedOrigins],
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Accept",
      "Authorization",
      "Content-Type",
      "X-Admin-Token",
      "X-CSRF-Token",
      "X-Request-ID"
    ],
    exposedHeaders: ["X-Request-ID"],
    credentials: false,
    maxAge: 86_400
  };
}

function readAllowedOrigins(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) {
    return [];
  }

  const origins = value.split(",").map((origin) => normalizeOrigin(origin));
  return [...new Set(origins)];
}

function normalizeOrigin(value: string): string {
  const candidate = value.trim();

  if (candidate.length === 0 || candidate === "*") {
    throw new Error(
      "CORS_ALLOWED_ORIGINS must contain exact HTTP or HTTPS origins."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Invalid CORS origin '${candidate}'.`);
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error(
      `CORS origin '${candidate}' must be an exact HTTP or HTTPS origin without credentials, a path, a query, or a fragment.`
    );
  }

  return parsed.origin;
}

function readIntegerInRange(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`
    );
  }

  return parsed;
}
