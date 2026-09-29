/**
 * Authentication and Role-Based Authorization Middleware.
 *
 * Provides both the `AuthValidator` helper (API-key -> role resolution and
 * HMAC payload signing) and Express middleware wrappers (`authMiddleware`,
 * `requireRole`, `requireAdmin`) so routes can enforce authentication.
 * Previously these helpers were exported from the package barrel but never
 * applied to any route (see #1196).
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export type UserRole = 'User' | 'ComplianceOfficer' | 'Assessor' | 'Admin';

export interface AuthContext {
  apiKey?: string;
  role: UserRole;
  subjectAddress?: string;
}

export class AuthValidator {
  private adminKeys = new Set<string>();
  private officerKeys = new Set<string>();
  private assessorKeys = new Set<string>();
  private secretKey: string;

  constructor(secretKey: string = 'stellar-lend-production-secret-key-32b') {
    this.secretKey = secretKey;
  }

  public registerKey(apiKey: string, role: UserRole): void {
    if (role === 'Admin') this.adminKeys.add(apiKey);
    if (role === 'ComplianceOfficer') this.officerKeys.add(apiKey);
    if (role === 'Assessor') this.assessorKeys.add(apiKey);
  }

  public authenticate(headers: Record<string, string | undefined>): AuthContext {
    const apiKey = headers['x-api-key'];
    if (!apiKey) {
      return { role: 'User' };
    }

    if (this.adminKeys.has(apiKey)) {
      return { apiKey, role: 'Admin' };
    }
    if (this.officerKeys.has(apiKey)) {
      return { apiKey, role: 'ComplianceOfficer' };
    }
    if (this.assessorKeys.has(apiKey)) {
      return { apiKey, role: 'Assessor' };
    }

    return { apiKey, role: 'User' };
  }

  public verifySignature(payload: string, signature: string): boolean {
    if (!signature.startsWith('sha256=')) {
      return false;
    }
    const expected = 'sha256=' + createHmac('sha256', this.secretKey).update(payload).digest('hex');
    if (expected.length !== signature.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  public signPayload(payload: string): string {
    return 'sha256=' + createHmac('sha256', this.secretKey).update(payload).digest('hex');
  }
}

/**
 * Shared validator instance wired to Express middleware below.
 * API keys are loaded from the environment so operators can harden the API
 * without code changes:
 *   ADMIN_API_KEYS, OFFICER_API_KEYS, ASSESSOR_API_KEYS (comma-separated)
 *   AUTH_SECRET
 */
function loadKeysFromEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

export const sharedAuthValidator = new AuthValidator(
  process.env.AUTH_SECRET || 'stellar-lend-production-secret-key-32b'
);

for (const key of loadKeysFromEnv(process.env.ADMIN_API_KEYS)) {
  sharedAuthValidator.registerKey(key, 'Admin');
}
for (const key of loadKeysFromEnv(process.env.OFFICER_API_KEYS)) {
  sharedAuthValidator.registerKey(key, 'ComplianceOfficer');
}
for (const key of loadKeysFromEnv(process.env.ASSESSOR_API_KEYS)) {
  sharedAuthValidator.registerKey(key, 'Assessor');
}

/**
 * Attach `req.auth` for every request. Never blocks — use `requireRole`
 * after it to enforce authorization on sensitive routes.
 */
export function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const apiKey =
    (req.headers['x-api-key'] as string | undefined) ||
    (req.query.apiKey as string | undefined);
  const ctx = sharedAuthValidator.authenticate(
    apiKey ? { 'x-api-key': apiKey } : {}
  );
  (req as any).auth = ctx;
  next();
}

/**
 * Enforce that the caller holds one of the allowed roles.
 * Returns 401 when the role check fails.
 */
export function requireRole(roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const existing = (req as any).auth as AuthContext | undefined;
    const ctx =
      existing ||
      sharedAuthValidator.authenticate({
        'x-api-key': req.headers['x-api-key'] as string | undefined,
      });
    (req as any).auth = ctx;
    if (!roles.includes(ctx.role)) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: `Requires one of roles: ${roles.join(', ')}`,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }
    next();
  };
}

/** Shorthand for admin-only routes (emergency controls, etc). */
export const requireAdmin = requireRole(['Admin']);

/** Shorthand for compliance officer + admin routes. */
export const requireComplianceOfficer = requireRole([
  'Admin',
  'ComplianceOfficer',
]);
