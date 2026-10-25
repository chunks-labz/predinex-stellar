/**
 * Session Validator
 * Utilities for validating and managing wallet sessions
 */

import { WalletSession } from './wallet-service';
import { SessionStorageService } from './session-storage';
import { createScopedLogger } from './logger';

const log = createScopedLogger('session-validator');

export interface SessionValidationResult {
  isValid: boolean;
  reason?: string;
  shouldReconnect?: boolean;
}

export class SessionValidator {
  private static readonly MAX_INACTIVITY_HOURS = 24;
  private static readonly MAX_SESSION_DAYS = 7;

  /**
   * Validate a wallet session
   */
  static validateSession(session: WalletSession): SessionValidationResult {
    if (!session) {
      return { isValid: false, reason: 'No session provided' };
    }

    // Check required fields
    if (!session.address || !session.publicKey) {
      return { 
        isValid: false, 
        reason: 'Missing required session data',
        shouldReconnect: true 
      };
    }

    // Check if session is marked as connected
    if (!session.isConnected) {
      return { 
        isValid: false, 
        reason: 'Session marked as disconnected',
        shouldReconnect: true 
      };
    }

    // Check session age
    const sessionAge = Date.now() - new Date(session.connectedAt).getTime();
    const maxAge = this.MAX_SESSION_DAYS * 24 * 60 * 60 * 1000;
    
    if (sessionAge > maxAge) {
      return { 
        isValid: false, 
        reason: 'Session expired',
        shouldReconnect: true 
      };
    }

    // Check inactivity
    const lastActivity = Date.now() - new Date(session.lastActivity).getTime();
    const maxInactivity = this.MAX_INACTIVITY_HOURS * 60 * 60 * 1000;
    
    if (lastActivity > maxInactivity) {
      return { 
        isValid: false, 
        reason: 'Session inactive too long',
        shouldReconnect: true 
      };
    }

    // Check address format
    if (!this.isValidStellarAddress(session.address)) {
      return { 
        isValid: false, 
        reason: 'Invalid address format',
        shouldReconnect: true 
      };
    }

    return { isValid: true };
  }

  /**
   * Validate and clean up stored session
   */
  static async validateStoredSession(): Promise<WalletSession | null> {
    try {
      const storedSession = SessionStorageService.retrieveSession();
      
      if (!storedSession) {
        return null;
      }

      const validation = this.validateSession(storedSession);
      
      if (!validation.isValid) {
        log.debug(`Session invalid: ${validation.reason}`);
        SessionStorageService.clearSession();
        return null;
      }

      return storedSession;
    } catch (error) {
      log.error('Session validation failed', error);
      SessionStorageService.clearSession();
      return null;
    }
  }

  /**
   * Check if address is a valid Stellar address
   */
  private static isValidStellarAddress(address: string): boolean {
    // Stellar addresses start with G (public keys) or C (contracts), 56 characters total
    const stellarAddressRegex = /^[GC][A-Z0-9]{55}$/;
    return stellarAddressRegex.test(address);
  }

  /**
   * Refresh session activity timestamp
   */
  static refreshActivity(session: WalletSession): WalletSession {
    const updatedSession = {
      ...session,
      lastActivity: new Date(),
    };
    
    SessionStorageService.storeSession(updatedSession);
    return updatedSession;
  }

  /**
   * Check if session needs refresh
   */
  static needsRefresh(session: WalletSession): boolean {
    const lastActivity = Date.now() - new Date(session.lastActivity).getTime();
    const refreshThreshold = 5 * 60 * 1000; // 5 minutes
    
    return lastActivity > refreshThreshold;
  }

  /**
   * Get session health status
   */
  static getSessionHealth(session: WalletSession): {
    status: 'healthy' | 'warning' | 'expired';
    message: string;
    timeRemaining?: number;
  } {
    const validation = this.validateSession(session);
    
    if (!validation.isValid) {
      return {
        status: 'expired',
        message: validation.reason || 'Session invalid'
      };
    }

    const sessionAge = Date.now() - new Date(session.connectedAt).getTime();
    const maxAge = this.MAX_SESSION_DAYS * 24 * 60 * 60 * 1000;
    const timeRemaining = maxAge - sessionAge;
    
    if (timeRemaining < 24 * 60 * 60 * 1000) { // Less than 1 day
      return {
        status: 'warning',
        message: 'Session expires soon',
        timeRemaining
      };
    }

    return {
      status: 'healthy',
      message: 'Session active',
      timeRemaining
    };
  }
}