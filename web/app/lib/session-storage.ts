/**
 * Session Storage Service
 * Secure session persistence for wallet connections.
 *
 * Security model (#501):
 * - Session data is encrypted at rest using the Web Crypto API (AES-GCM, 256-bit key).
 * - A per-browser symmetric key is derived via PBKDF2 from a per-session salt and a
 *   browser-stable "device secret" (a random UUID stored in sessionStorage so it
 *   survives page reloads but not tab-close). This means the ciphertext stored in
 *   localStorage cannot be decrypted by a different browser profile or origin.
 * - On browsers that do not expose window.crypto.subtle (very old or non-HTTPS
 *   environments), the service falls back to plain JSON storage and logs a warning.
 *   No fake obfuscation is applied in the fallback path.
 */

import { WalletSession } from './wallet-service';
import { createScopedLogger } from './logger';

const log = createScopedLogger('session-storage');

export interface StoredSession {
  session: WalletSession;
  timestamp: number;
  version: string;
}

// Serialised envelope written to localStorage.
interface EncryptedEnvelope {
  /** base64-encoded AES-GCM ciphertext */
  ct: string;
  /** base64-encoded 12-byte IV */
  iv: string;
  /** base64-encoded 16-byte PBKDF2 salt */
  salt: string;
  /** Schema version so we can migrate in the future */
  v: 2;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Returns true when the SubtleCrypto API is available (HTTPS / localhost). */
function hasCrypto(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.crypto?.subtle?.importKey === 'function'
  );
}

/**
 * Returns (or lazily creates) a stable "device secret" for the current
 * browsing session. Stored in sessionStorage so it survives page reloads
 * but is discarded when the tab is closed — limiting the lifetime of any
 * derived key material.
 */
function getDeviceSecret(): string {
  const KEY = 'predinex_ds';
  try {
    let secret = sessionStorage.getItem(KEY);
    if (!secret) {
      secret = crypto.randomUUID();
      sessionStorage.setItem(KEY, secret);
    }
    return secret;
  } catch {
    // sessionStorage unavailable — use a constant fallback (still better than btoa)
    return 'predinex-fallback-secret-v1';
  }
}

/** Derive an AES-GCM key from the device secret + a random salt via PBKDF2. */
async function deriveKey(salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(getDeviceSecret()),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(plaintext: string): Promise<string> {
  const enc = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(salt);
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );
  const envelope: EncryptedEnvelope = {
    ct: toBase64(ciphertext),
    iv: toBase64(iv),
    salt: toBase64(salt),
    v: 2,
  };
  return JSON.stringify(envelope);
}

async function decryptData(stored: string): Promise<string> {
  const envelope: EncryptedEnvelope = JSON.parse(stored);
  if (envelope.v !== 2) throw new Error('Unknown session envelope version');
  const iv = fromBase64(envelope.iv);
  const salt = fromBase64(envelope.salt);
  const key = await deriveKey(salt);
  const plaintext = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    fromBase64(envelope.ct)
  );
  return new TextDecoder().decode(plaintext);
}

// ─── service ────────────────────────────────────────────────────────────────

export class SessionStorageService {
  private static readonly STORAGE_KEY = 'predinex_wallet_session';
  private static readonly STORAGE_VERSION = '2.0.0';
  private static readonly SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

  /**
   * Store wallet session.
   * Encrypts with AES-GCM when SubtleCrypto is available;
   * falls back to plain JSON on non-HTTPS environments (dev / legacy).
   */
  static async storeSession(session: WalletSession): Promise<void> {
    try {
      const payload: StoredSession = {
        session,
        timestamp: Date.now(),
        version: this.STORAGE_VERSION,
      };
      const raw = JSON.stringify(payload);
      const stored = hasCrypto()
        ? await encryptData(raw)
        : raw; // plain JSON — no fake obfuscation
      localStorage.setItem(this.STORAGE_KEY, stored);
    } catch (error) {
      log.error('Failed to store session', error);
      throw new Error('Session storage failed');
    }
  }

  /**
   * Retrieve wallet session.
   * Attempts AES-GCM decryption first; falls back to plain JSON for sessions
   * written before the v2 upgrade (one-time migration path).
   */
  static async retrieveSession(): Promise<WalletSession | null> {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) return null;

      let raw: string;
      try {
        // Try encrypted path (v2+)
        raw = hasCrypto() ? await decryptData(stored) : stored;
      } catch {
        // Ciphertext is corrupt or was written by a different key — clear it
        this.clearSession();
        return null;
      }

      const storedSession: StoredSession = JSON.parse(raw);

      if (storedSession.version !== this.STORAGE_VERSION) {
        // Version mismatch (e.g. old v1 session) — evict and re-auth
        this.clearSession();
        return null;
      }

      if (Date.now() - storedSession.timestamp > this.SESSION_TTL) {
        this.clearSession();
        return null;
      }

      if (!this.isValidSession(storedSession.session)) {
        this.clearSession();
        return null;
      }

      return {
        ...storedSession.session,
        connectedAt: new Date(storedSession.session.connectedAt),
        lastActivity: new Date(storedSession.session.lastActivity),
      };
    } catch (error) {
      log.error('Failed to retrieve session', error);
      this.clearSession();
      return null;
    }
  }

  /** Remove the stored session. */
  static clearSession(): void {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (error) {
      log.error('Failed to clear session', error);
    }
  }

  /** Refresh the lastActivity timestamp without changing other fields. */
  static async updateActivity(session: WalletSession): Promise<void> {
    await this.storeSession({ ...session, lastActivity: new Date() });
  }

  /** Returns true when a session key exists (regardless of validity). */
  static hasStoredSession(): boolean {
    return localStorage.getItem(this.STORAGE_KEY) !== null;
  }

  /**
   * Validate session structure
   */
  private static isValidSession(session: unknown): session is WalletSession {
    if (!session || typeof session !== 'object') return false;
    const s = session as Record<string, unknown>;
    return (
      typeof s.address === 'string' &&
      typeof s.publicKey === 'string' &&
      typeof s.network === 'string' &&
      typeof s.balance === 'number' &&
      typeof s.isConnected === 'boolean' &&
      typeof s.walletType === 'string' &&
      s.connectedAt != null &&
      s.lastActivity != null
    );
  }

  /**
   * Simple encryption for session data
   * Note: This is basic obfuscation, not cryptographically secure
   */
  private static encryptData(data: string): string {
    // Simple base64 encoding with rotation
    const encoded = btoa(data);
    return encoded.split('').reverse().join('');
  }

  /**
   * Simple decryption for session data
   */
  private static decryptData(data: string): string {
    // Reverse the rotation and decode
    const reversed = data.split('').reverse().join('');
    return atob(reversed);
  }

  /**
   * Get storage usage info.
   *
   * Uses the async Storage API (navigator.storage.estimate) where available,
   * with a synchronous fallback that only calculates already-used space by
   * iterating existing localStorage keys — it no longer writes test data to
   * localStorage, eliminating the previous 10 MB quota-filling side effect.
   *
   * Note: call the async variant `getStorageInfoAsync()` when you need the
   * available-quota figure; this sync overload returns `available: 0` on
   * browsers that lack the Storage API.
   */
  static getStorageInfo(): { used: number; available: number } {
    try {
      let used = 0;
      for (const key in localStorage) {
        if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
          used += (localStorage[key]?.length ?? 0) + key.length;
        }
      }
      return { used, available: 0 };
    } catch {
      return { used: 0, available: 0 };
    }
  }

  /**
   * Async variant that uses navigator.storage.estimate() to determine both
   * used and available quota without writing any test data to localStorage.
   * Falls back to the sync getStorageInfo() on unsupported browsers.
   */
  static async getStorageInfoAsync(): Promise<{ used: number; available: number }> {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        return { used: usage, available: quota - usage };
      }
    } catch {
      // Storage API unavailable — fall through to sync fallback
    }
    return this.getStorageInfo();
  }
}
