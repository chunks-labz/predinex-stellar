/**
 * Authentication and Role-Based Authorization Middleware.
 */

import { createHmac, timingSafeEqual } from 'crypto';

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
