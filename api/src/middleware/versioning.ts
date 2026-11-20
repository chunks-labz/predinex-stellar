/**
 * API Versioning & Deprecation Middleware
 *
 * Implements the Predinex API Versioning Policy:
 * - URI-based versioning (`/api/v1/*`) alongside `/api/*` (defaults to `v1`)
 *   and header-based negotiation (`X-API-Version` / `Accept-Version`).
 * - Minimum 90-day deprecation/support window before sunsetting breaking changes.
 * - Emits RFC 8594 `Deprecation` and RFC 8594 / RFC 7231 `Sunset` headers
 *   (plus `Link: <successor>; rel="successor-version"` when configured) on
 *   deprecated endpoints.
 * - Exposes `findEndpointsMissingVersion()` to lint OpenAPI specifications for
 *   endpoints missing a documented version (`x-api-version` or `/api/v{N}/` prefix).
 */

import { NextFunction, Request, RequestHandler, Response } from 'express';

export const CURRENT_API_VERSION = 'v1';
export const SUPPORTED_API_VERSIONS = ['v1'] as const;
export const DEFAULT_DEPRECATION_WINDOW_DAYS = 90;

export type ApiVersion = (typeof SUPPORTED_API_VERSIONS)[number];

export interface DeprecatedEndpointRule {
  /** Method (`GET`, `POST`, etc.) or `*` for all methods */
  method?: string;
  /** Route path or prefix (e.g. `/api/simulation/position-health`) */
  path: string;
  /** ISO-8601 or HTTP-date when the endpoint was marked deprecated */
  deprecatedAt?: string;
  /** ISO-8601 or HTTP-date when the endpoint will be removed (Sunset header) */
  sunsetAt: string;
  /** Optional successor endpoint path for `Link` header */
  successorPath?: string;
}

/**
 * Default deprecated endpoint registry.
 * `/api/simulation/position-health` is a deprecated alias for `/api/simulation/simulate`.
 */
export const DEFAULT_DEPRECATED_ENDPOINTS: DeprecatedEndpointRule[] = [
  {
    method: 'POST',
    path: '/api/simulation/position-health',
    deprecatedAt: '2026-01-01T00:00:00Z',
    sunsetAt: '2026-12-31T23:59:59Z',
    successorPath: '/api/v1/simulation/simulate',
  },
  {
    method: 'POST',
    path: '/api/v1/simulation/position-health',
    deprecatedAt: '2026-01-01T00:00:00Z',
    sunsetAt: '2026-12-31T23:59:59Z',
    successorPath: '/api/v1/simulation/simulate',
  },
];

let registeredDeprecations: DeprecatedEndpointRule[] = [...DEFAULT_DEPRECATED_ENDPOINTS];

/**
 * Registers a deprecated endpoint rule at runtime.
 */
export function registerDeprecatedEndpoint(rule: DeprecatedEndpointRule): void {
  registeredDeprecations.push(rule);
}

/**
 * Resets registered deprecation rules back to defaults.
 */
export function resetDeprecatedEndpoints(): void {
  registeredDeprecations = [...DEFAULT_DEPRECATED_ENDPOINTS];
}

/**
 * Formats an ISO date string into an HTTP-date (RFC 7231) for the `Sunset` header.
 */
export function toHttpDate(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) {
    return String(dateInput);
  }
  return date.toUTCString();
}

/**
 * Formats an ISO date string as an RFC 8594 `@<unix-epoch-seconds>` Deprecation value,
 * or `'true'` if no valid timestamp is provided.
 */
export function toDeprecationHeaderValue(deprecatedAt?: string | Date): string {
  if (!deprecatedAt) {
    return 'true';
  }
  const date = typeof deprecatedAt === 'string' ? new Date(deprecatedAt) : deprecatedAt;
  if (Number.isNaN(date.getTime())) {
    return 'true';
  }
  return `@${Math.floor(date.getTime() / 1000)}`;
}

/**
 * Route-level middleware factory to mark a specific endpoint as deprecated
 * and attach `Deprecation`, `Sunset`, and optional `Link` headers.
 */
export function deprecateEndpoint(options: {
  deprecatedAt?: string | Date;
  sunsetAt: string | Date;
  successorPath?: string;
}): RequestHandler {
  const deprecationValue = toDeprecationHeaderValue(options.deprecatedAt);
  const sunsetValue = toHttpDate(options.sunsetAt);

  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Deprecation', deprecationValue);
    res.setHeader('Sunset', sunsetValue);
    if (options.successorPath) {
      res.setHeader('Link', `<${options.successorPath}>; rel="successor-version"`);
    }
    next();
  };
}

/**
 * Resolves the requested API version from URI (`/api/v1/...`) or headers
 * (`X-API-Version`, `Accept-Version`), defaulting to `CURRENT_API_VERSION`.
 */
export function resolveRequestedApiVersion(req: Request): string {
  const uriMatch = req.path.match(/^\/api\/(v\d+)(?:\/|$)/i);
  if (uriMatch) {
    return uriMatch[1].toLowerCase();
  }
  const headerVersion =
    req.header('x-api-version')?.trim() || req.header('accept-version')?.trim();
  if (headerVersion) {
    return headerVersion.toLowerCase().startsWith('v')
      ? headerVersion.toLowerCase()
      : `v${headerVersion.toLowerCase()}`;
  }
  return CURRENT_API_VERSION;
}

/**
 * Express middleware that enforces the API versioning contract, sets
 * `X-API-Version` on responses, rewrites `/api/v1/*` requests to `/api/*`
 * so versioned and unversioned paths share the same routers, and attaches
 * `Deprecation` and `Sunset` headers on deprecated endpoints.
 */
export function versioningMiddleware(req: Request, res: Response, next: NextFunction): void {
  const originalPath = req.path;
  const requestedVersion = resolveRequestedApiVersion(req);

  res.setHeader('X-API-Version', CURRENT_API_VERSION);

  if (
    (originalPath.startsWith('/api/') || originalPath === '/api') &&
    !(SUPPORTED_API_VERSIONS as readonly string[]).includes(requestedVersion)
  ) {
    res.status(400).json({
      success: false,
      error: {
        code: 'UNSUPPORTED_API_VERSION',
        message: `Unsupported API version '${requestedVersion}'. Supported versions: ${SUPPORTED_API_VERSIONS.join(', ')}`,
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Check if the request matches any deprecated endpoint rule
  const normalizedPath = originalPath.replace(/\/+$/, '') || '/';
  const matchingRule = registeredDeprecations.find((rule) => {
    const methodMatches =
      !rule.method || rule.method === '*' || rule.method.toUpperCase() === req.method.toUpperCase();
    const rulePath = rule.path.replace(/\/+$/, '') || '/';
    return methodMatches && normalizedPath === rulePath;
  });

  if (matchingRule) {
    res.setHeader('Deprecation', toDeprecationHeaderValue(matchingRule.deprecatedAt));
    res.setHeader('Sunset', toHttpDate(matchingRule.sunsetAt));
    if (matchingRule.successorPath) {
      res.setHeader('Link', `<${matchingRule.successorPath}>; rel="successor-version"`);
    }
  }

  // Rewrite `/api/v1/...` to `/api/...` so existing routers handle both seamlessly
  if (/^\/api\/v1(\/|$)/i.test(req.url)) {
    req.url = req.url.replace(/^\/api\/v1(\/|$)/i, '/api$1');
  }

  next();
}

export interface UnversionedEndpointWarning {
  path: string;
  method: string;
  reason: string;
}

/**
 * Lint helper that inspects an OpenAPI specification and flags any operation
 * missing a documented API version (`x-api-version` on the operation, path item,
 * or root `info['x-api-version']`, or a `/api/v{N}/` path prefix).
 */
export function findEndpointsMissingVersion(openApiSpec: {
  info?: { version?: string; 'x-api-version'?: string };
  paths?: Record<string, Record<string, any>>;
}): UnversionedEndpointWarning[] {
  const warnings: UnversionedEndpointWarning[] = [];
  const paths = openApiSpec.paths ?? {};
  const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

  for (const [pathKey, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    const hasVersionInPath = /^\/api\/v\d+\//i.test(pathKey);
    const pathVersion = pathItem['x-api-version'];

    for (const method of httpMethods) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') continue;

      const opVersion = operation['x-api-version'] ?? pathVersion;
      if (!hasVersionInPath && !opVersion) {
        warnings.push({
          path: pathKey,
          method: method.toUpperCase(),
          reason: `Endpoint ${method.toUpperCase()} ${pathKey} is missing a documented 'x-api-version' or '/api/v{N}/' path prefix`,
        });
      }
    }
  }

  return warnings;
}
