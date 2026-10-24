/**
 * Server-side admin authorization.
 *
 * Admin identity is established by a wallet-ownership proof (see
 * `wallet-auth.ts`) and then checked against the on-chain contract/freeze
 * admins plus an optional `ADMIN_ADDRESSES` allowlist. A successful check is
 * recorded in a short-lived HMAC-signed, httpOnly cookie that admin data
 * routes must verify with `requireAdminSession` before returning anything.
 *
 * Client components (AdminGuard) only mirror this decision for UX; they are
 * never the security boundary.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { getAdminFromSoroban, getFreezeAdminFromSoroban } from './soroban-read-api';

export const ADMIN_SESSION_COOKIE = 'predinex_admin_session';
export const ADMIN_SESSION_TTL_MS = 30 * 60 * 1000;
export const ADMIN_AUTH_SCOPE = 'admin';

export type AdminRole = 'contract-admin' | 'freeze-admin' | 'allowlisted';

export interface AdminSession {
  address: string;
  roles: AdminRole[];
  expiresAt: number;
}

function getSessionSecret(): string | null {
  const secret = process.env.ADMIN_SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Resolve the admin roles held by an address. Empty means not an admin. */
export async function resolveAdminRoles(address: string): Promise<AdminRole[]> {
  const normalized = address.toUpperCase();
  const roles: AdminRole[] = [];

  const [contractAdmin, freezeAdmin] = await Promise.all([
    getAdminFromSoroban().catch(() => null),
    getFreezeAdminFromSoroban().catch(() => null),
  ]);
  if (contractAdmin && contractAdmin.toUpperCase() === normalized) roles.push('contract-admin');
  if (freezeAdmin && freezeAdmin.toUpperCase() === normalized) roles.push('freeze-admin');

  const allowlist = (process.env.ADMIN_ADDRESSES ?? '')
    .split(',')
    .map((a) => a.trim().toUpperCase())
    .filter(Boolean);
  if (allowlist.includes(normalized)) roles.push('allowlisted');

  return roles;
}

export function issueAdminSession(address: string, roles: AdminRole[], now = Date.now()): string | null {
  const secret = getSessionSecret();
  if (!secret) return null;
  const session: AdminSession = { address, roles, expiresAt: now + ADMIN_SESSION_TTL_MS };
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyAdminSessionToken(token: string | undefined, now = Date.now()): AdminSession | null {
  const secret = getSessionSecret();
  if (!secret || !token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AdminSession;
    if (typeof session.expiresAt !== 'number' || session.expiresAt <= now) return null;
    if (!Array.isArray(session.roles) || session.roles.length === 0) return null;
    return session;
  } catch {
    return null;
  }
}

/**
 * Guard for admin data routes. Returns the session, or null when the caller
 * is not an authorized admin; callers must respond 401/403 on null.
 */
export function requireAdminSession(request: NextRequest): AdminSession | null {
  return verifyAdminSessionToken(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
}
