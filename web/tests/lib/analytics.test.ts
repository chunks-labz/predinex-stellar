/**
 * Analytics Taxonomy Tests
 * 
 * Verifies that analytics instrumentation follows the canonical taxonomy
 * and properly handles sensitive data.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { analytics, startTimer, bucketAmount, bucketVolume, bucketOdds } from '../../app/lib/analytics';
import type { AnalyticsProvider } from '../../app/lib/analytics/service';

describe('Analytics Taxonomy', () => {
  let mockProvider: AnalyticsProvider;
  let trackSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    trackSpy = vi.fn();
    mockProvider = {
      track: trackSpy,
    };
    
    analytics.configure({ enabled: true, debug: false });
    analytics.setProvider(mockProvider);
  });

  describe('Wallet Flow Events', () => {
    it('emits wallet.connect.attempt with correct payload', () => {
      analytics.emit('wallet.connect.attempt', {
        walletType: 'freighter',
      });

      expect(trackSpy).toHaveBeenCalledWith(
        'wallet.connect.attempt',
        expect.objectContaining({
          walletType: 'freighter',
          sessionId: expect.any(String),
        })
      );
    });

    it('emits wallet.connect.success with duration', () => {
      analytics.emit('wallet.connect.success', {
        walletType: 'freighter',
        durationMs: 1500,
      });

      expect(trackSpy).toHaveBeenCalledWith(
        'wallet.connect.success',
        expect.objectContaining({
          walletType: 'freighter',
          durationMs: 1500,
        })
      );
    });

    it('emits wallet.connect.failure with redacted error', () => {
      analytics.emit('wallet.connect.failure', {
        walletType: 'freighter',
        errorMessage: 'Connection failed for address GBXXX...ABC123',
        durationMs: 2000,
      });

      const call = trackSpy.mock.calls[0][1];
      expect(call.errorMessage).not.toContain('GBXXX');
      expect(call.errorMessage).toContain('[STELLAR_ADDRESS]');
    });

    it('emits wallet.disconnect with session metrics', () => {
      analytics.emit('wallet.disconnect', {
        sessionDurationMs: 300000,
        interactionCount: 5,
      });

      expect(trackSpy).toHaveBeenCalledWith(
        'wallet.disconnect',
        expect.objectContaining({
          sessionDurationMs: 300000,
          interactionCount: 5,
        })
      );
    });
  });

  describe('Market Discovery Events', () => {
    it('emits market.discovery.view with filter state', () => {
      analytics.emit('market.discovery.view', {
        marketCount: 42,
        filterApplied: true,
        sortBy: 'volume',
      });

      expect(trackSpy).toHaveBeenCalledWith(
        'market.discovery.view',
        expect.objectContaining({
          marketCount: 42,
          filterApplied: true,
          sortBy: 'volume',
        })
      );
    });

    it('emits market.discovery.search without query text', () => {
      analytics.emit('market.discovery.search', {
        queryLength: 15,
        resultCount: 8,
        durationMs: 250,
      });

      const call = trackSpy.mock.calls[0][1];
      expect(call).not.toHaveProperty('query');
      expect(call.queryLength).toBe(15);
    });

    it('emits market.detail.view with pool metadata', () => {
      analytics.emit('market.detail.view', {
        poolId: 42,
        poolStatus: 'open',
        volumeRange: 'high',
        timeToExpiry: 86400,
      });

      expect(trackSpy).toHaveBeenCalledWith(
        'market.detail.view',
        expect.objectContaining({
          poolId: 42,
          poolStatus: 'open',
        })
      );
    });
  });

  describe('Market Creation Events', () => {
    it('emits market.create.start with source', () => {
      analytics.emit('market.create.start', {
        source: 'nav_button',
      });

      expect(trackSpy).toHaveBeenCalledWith(
        'market.create.start',
        expect.objectContaining({
          source: 'nav_button',
        })
      );
    });

    it('emits market.create.preview without sensitive data', () => {
      analytics.emit('market.create.preview', {
        hasDescription: true,
        expiryDurationHours: 24,
        outcomeCount: 2,
      });

      const call = trackSpy.mock.calls[0][1];
      expect(call).not.toHaveProperty('title');
      expect(call).not.toHaveProperty('description');
      expect(call.hasDescription).toBe(true);
    });

    it('emits market.create.success with pool ID', () => {
      analytics.emit('market.create.success', {
        poolId: 42,
        durationMs: 3500,
        blockHeight: 123456,
      });

      expect(trackSpy).toHaveBeenCalledWith(
        'market.create.success',
        expect.objectContaining({
          poolId: 42,
          durationMs: 3500,
        })
      );
    });

    it('emits market.create.failure with stage and redacted error', () => {
      analytics.emit('market.create.failure', {
        errorMessage: 'Transaction failed: insufficient balance at GBXXX...ABC',
        errorCode: 'INSUFFICIENT_BALANCE',
        stage: 'submission',
        durationMs: 2000,
      });

      const call = trackSpy.mock.calls[0][1];
      expect(call.errorMessage).toContain('[STELLAR_ADDRESS]');
      expect(call.stage).toBe('submission');
    });
  });

  describe('Betting Flow Events', () => {
    it('emits bet.form.open with current odds', () => {
      analytics.emit('bet.form.open', {
        poolId: 42,
        poolStatus: 'open',
        currentOddsA: 0.55,
        currentOddsB: 0.45,
      });

      expect(trackSpy).toHaveBeenCalledWith(
        'bet.form.open',
        expect.objectContaining({
          poolId: 42,
          currentOddsA: 0.55,
        })
      );
    });

    it('emits bet.amount.input with bucketed amount', () => {
      analytics.emit('bet.amount.input', {
        poolId: 42,
        amountRange: 'medium',
        outcome: 0,
      });

      const call = trackSpy.mock.calls[0][1];
      expect(call).not.toHaveProperty('amount');
      expect(call.amountRange).toBe('medium');
    });

    it('emits bet.submit without exact amount', () => {
      analytics.emit('bet.submit', {
        poolId: 42,
        outcome: 1,
        amountRange: 'large',
      });

      const call = trackSpy.mock.calls[0][1];
      expect(call).not.toHaveProperty('amount');
      expect(call.amountRange).toBe('large');
    });

    it('emits bet.success with outcome', () => {
      analytics.emit('bet.success', {
        poolId: 42,
        outcome: 0,
        durationMs: 4000,
        blockHeight: 123457,
      });

      expect(trackSpy).toHaveBeenCalledWith(
        'bet.success',
        expect.objectContaining({
          poolId: 42,
          outcome: 0,
        })
      );
    });
  });

  describe('Claim Flow Events', () => {
    it('emits claim.eligible.view with bucketed amount', () => {
      analytics.emit('claim.eligible.view', {
        poolId: 42,
        claimType: 'winnings',
        amountRange: 'large',
      });

      const call = trackSpy.mock.calls[0][1];
      expect(call).not.toHaveProperty('amount');
      expect(call.claimType).toBe('winnings');
    });

    it('emits claim.submit for refund', () => {
      analytics.emit('claim.submit', {
        poolId: 42,
        claimType: 'refund',
        amountRange: 'small',
      });

      expect(trackSpy).toHaveBeenCalledWith(
        'claim.submit',
        expect.objectContaining({
          claimType: 'refund',
        })
      );
    });

    it('emits claim.success with duration', () => {
      analytics.emit('claim.success', {
        poolId: 42,
        claimType: 'winnings',
        durationMs: 3000,
      });

      expect(trackSpy).toHaveBeenCalledWith(
        'claim.success',
        expect.objectContaining({
          durationMs: 3000,
        })
      );
    });
  });

  describe('Privacy & Sensitive Data', () => {
    it('redacts Stellar addresses from error messages', () => {
      analytics.emit('bet.failure', {
        poolId: 42,
        outcome: 0,
        errorMessage: 'Failed for address GBXXX...ABC123',
        stage: 'submission',
        durationMs: 1000,
      });

      const call = trackSpy.mock.calls[0][1];
      expect(call.errorMessage).not.toContain('GBXXX');
    });

    it('redacts hex strings from error messages', () => {
      analytics.emit('claim.failure', {
        poolId: 42,
        claimType: 'winnings',
        errorMessage: 'Transaction hash: 0x1234567890abcdef1234567890abcdef',
        stage: 'confirmation',
        durationMs: 2000,
      });

      const call = trackSpy.mock.calls[0][1];
      expect(call.errorMessage).toContain('[HEX_REDACTED]');
    });

    it('never captures wallet addresses in payloads', () => {
      analytics.emit('wallet.connect.success', {
        walletType: 'freighter',
        durationMs: 1500,
      });

      const call = trackSpy.mock.calls[0][1];
      expect(call).not.toHaveProperty('address');
      expect(call).not.toHaveProperty('publicKey');
    });

    it('never captures exact bet amounts', () => {
      analytics.emit('bet.submit', {
        poolId: 42,
        outcome: 0,
        amountRange: 'medium',
      });

      const call = trackSpy.mock.calls[0][1];
      expect(call).not.toHaveProperty('amount');
      expect(call).not.toHaveProperty('exactAmount');
    });
  });

  describe('Utility Functions', () => {
    describe('bucketAmount', () => {
      it('buckets micro amounts correctly', () => {
        expect(bucketAmount(5_000_000)).toBe('micro'); // 0.5 XLM
        expect(bucketAmount(50_000_000)).toBe('small'); // 5 XLM
      });

      it('buckets small amounts correctly', () => {
        expect(bucketAmount(100_000_000)).toBe('small'); // 10 XLM
        expect(bucketAmount(500_000_000)).toBe('small'); // 50 XLM
      });

      it('buckets medium amounts correctly', () => {
        expect(bucketAmount(1_000_000_000)).toBe('medium'); // 100 XLM
        expect(bucketAmount(5_000_000_000)).toBe('medium'); // 500 XLM
      });

      it('buckets large amounts correctly', () => {
        expect(bucketAmount(10_000_000_000)).toBe('large'); // 1000 XLM
        expect(bucketAmount(50_000_000_000)).toBe('large'); // 5000 XLM
      });

      it('buckets whale amounts correctly', () => {
        expect(bucketAmount(100_000_000_000)).toBe('whale'); // 10000 XLM
        expect(bucketAmount(1_000_000_000_000)).toBe('whale'); // 100000 XLM
      });
    });

    describe('bucketVolume', () => {
      it('buckets low volume correctly', () => {
        expect(bucketVolume(500_000_000)).toBe('low'); // 50 XLM
      });

      it('buckets medium volume correctly', () => {
        expect(bucketVolume(50_000_000_000)).toBe('medium'); // 5000 XLM
      });

      it('buckets high volume correctly', () => {
        expect(bucketVolume(200_000_000_000)).toBe('high'); // 20000 XLM
      });
    });

    describe('bucketOdds', () => {
      it('rounds odds to 2 decimal places', () => {
        expect(bucketOdds(0.456789)).toBe(0.46);
        expect(bucketOdds(0.333333)).toBe(0.33);
        expect(bucketOdds(0.5)).toBe(0.5);
      });
    });
  });

  describe('Timer Utility', () => {
    it('measures elapsed time', async () => {
      const timer = startTimer();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const elapsed = timer.elapsed();
      
      expect(elapsed).toBeGreaterThanOrEqual(100);
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('Session Tracking', () => {
    it('includes session ID in all events', () => {
      analytics.emit('wallet.connect.attempt', {
        walletType: 'freighter',
      });

      expect(trackSpy).toHaveBeenCalledWith(
        'wallet.connect.attempt',
        expect.objectContaining({
          sessionId: expect.stringMatching(/^sess_/),
        })
      );
    });

    it('tracks interaction count', () => {
      const initialCount = analytics.getInteractionCount();
      
      analytics.emit('wallet.connect.attempt', { walletType: 'freighter' });
      analytics.emit('bet.submit', { poolId: 42, outcome: 0, amountRange: 'small' });
      
      expect(analytics.getInteractionCount()).toBe(initialCount + 2);
    });

    it('resets session on resetSession()', () => {
      const sessionId1 = trackSpy.mock.calls[0]?.[1]?.sessionId;
      
      analytics.resetSession();
      analytics.emit('wallet.connect.attempt', { walletType: 'freighter' });
      
      const sessionId2 = trackSpy.mock.calls[trackSpy.mock.calls.length - 1][1].sessionId;
      expect(sessionId2).not.toBe(sessionId1);
    });
  });
});
