import cors, { CorsOptions } from 'cors';

/**
 * Default explicit allowed origins for PrediNx API.
 * Never includes wildcard '*'.
 */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  'https://predinex.stellar.org',
  'https://app.predinex.stellar.org',
  'http://localhost:3000',
  'http://localhost:5173',
];

/**
 * Returns the list of permitted origins, sourced from environment or default.
 * Filters out wildcard '*' to ensure strict security.
 */
export function getAllowedOrigins(): string[] {
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (envOrigins) {
    return envOrigins
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== '*');
  }
  return [...DEFAULT_ALLOWED_ORIGINS];
}

/**
 * Creates express CORS options with explicit origin verification and disabled wildcard credentials.
 */
export function createCorsOptions(): CorsOptions {
  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., server-to-server, curl)
      if (!origin) {
        return callback(null, true);
      }

      const allowed = getAllowedOrigins();
      if (allowed.includes(origin)) {
        return callback(null, true);
      }

      // Disallowed origin: do not set Access-Control-Allow-Origin header
      return callback(null, false);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  };
}

/**
 * Pre-configured CORS middleware.
 */
export const corsMiddleware = cors(createCorsOptions());
