import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import DisputeManagement from '@/app/components/DisputeManagement';
import { isDisputeMockDataEnabled } from '@/app/lib/feature-flags';
import * as useDisputeManagementModule from '@/app/lib/disputes/useDisputeManagement';

// Mock the wallet provider
vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: () => ({
    address: '0x1234567890123456789012345678901234567890',
    isConnected: true,
  }),
}));

// Mock the useDisputeManagement hook
const mockUseDisputeManagement = vi.spyOn(useDisputeManagementModule, 'useDisputeManagement');

describe('Dispute Feature Flag', () => {
  beforeEach(() => {
    // Reset environment variables before each test
    delete process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('when feature flag is disabled', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA = 'false';
    });

    it('should show unavailable state when no disputes exist', () => {
      mockUseDisputeManagement.mockReturnValue({
        disputes: [],
        selectedTab: 'active',
        setSelectedTab: vi.fn(),
        isLoading: false,
        now: Date.now(),
        hasUserVoted: vi.fn(),
        getUserVote: vi.fn(),
        handleVote: vi.fn(),
      });

      render(<DisputeManagement />);

      expect(screen.getByText('Dispute Functionality Unavailable')).toBeInTheDocument();
      expect(
        screen.getByText('The dispute system is currently not available.')
      ).toBeInTheDocument();
    });

    it('should show disputes when real disputes exist', () => {
      const mockDisputes = [
        {
          id: 1,
          poolId: 1,
          poolTitle: 'Real Dispute',
          disputer: '0x123',
          disputeBond: 1000,
          disputeReason: 'Real reason',
          votingDeadline: Date.now() + 86400000,
          votesFor: 5,
          votesAgainst: 3,
          status: 'active' as const,
          createdAt: Date.now() - 3600000,
        },
      ];

      mockUseDisputeManagement.mockReturnValue({
        disputes: mockDisputes,
        selectedTab: 'active',
        setSelectedTab: vi.fn(),
        isLoading: false,
        now: Date.now(),
        hasUserVoted: vi.fn(),
        getUserVote: vi.fn(),
        handleVote: vi.fn(),
      });

      render(<DisputeManagement />);

      expect(screen.queryByText('Dispute Functionality Unavailable')).not.toBeInTheDocument();
      expect(screen.getByText('Real Dispute')).toBeInTheDocument();
    });
  });

  describe('when feature flag is enabled', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA = 'true';
    });

    it('should show mock disputes when no real disputes exist', () => {
      const mockDisputes = [
        {
          id: 0,
          poolId: 1,
          poolTitle: 'Bitcoin $100K Prediction',
          disputer: 'SP1HTBVD3JG9C05J7HBJTHGR0GGW7KX975CN0QKA',
          disputeBond: 115000,
          disputeReason: 'The automated resolution used incorrect price data.',
          votingDeadline: Date.now() + 86400000,
          votesFor: 3,
          votesAgainst: 7,
          status: 'active' as const,
          createdAt: Date.now() - 3600000,
        },
      ];

      mockUseDisputeManagement.mockReturnValue({
        disputes: mockDisputes,
        selectedTab: 'active',
        setSelectedTab: vi.fn(),
        isLoading: false,
        now: Date.now(),
        hasUserVoted: vi.fn(),
        getUserVote: vi.fn(),
        handleVote: vi.fn(),
      });

      render(<DisputeManagement />);

      expect(screen.queryByText('Dispute Functionality Unavailable')).not.toBeInTheDocument();
      expect(screen.getByText('Bitcoin $100K Prediction')).toBeInTheDocument();
      expect(screen.getByText('The automated resolution used incorrect price data.')).toBeInTheDocument();
    });
  });

  describe('feature flag utility functions', () => {
    it('should return false when flag is not set', () => {
      delete process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA;
      expect(isDisputeMockDataEnabled()).toBe(false);
    });

    it('should return false when flag is set to false', () => {
      process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA = 'false';
      expect(isDisputeMockDataEnabled()).toBe(false);
    });

    it('should return true when flag is set to true', () => {
      process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA = 'true';
      expect(isDisputeMockDataEnabled()).toBe(true);
    });

    it('should return false when flag is set to invalid value', () => {
      process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA = 'invalid';
      expect(isDisputeMockDataEnabled()).toBe(false);
    });

    it('should handle case insensitive values', () => {
      process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA = 'TRUE';
      expect(isDisputeMockDataEnabled()).toBe(true);

      process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA = 'FALSE';
      expect(isDisputeMockDataEnabled()).toBe(false);
    });

    it('should handle whitespace', () => {
      process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA = ' true ';
      expect(isDisputeMockDataEnabled()).toBe(true);
    });
  });
});
