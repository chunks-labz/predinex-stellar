import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Leaderboard from '../../components/Leaderboard';
import { renderWithProviders } from '../helpers/renderWithProviders';
import type { UseLeaderboardReturn } from '../../app/lib/hooks/useLeaderboard';

vi.mock('../../app/lib/hooks/useLeaderboard', () => ({
  useLeaderboard: vi.fn(),
}));
vi.mock('../../app/lib/address-display', () => ({
  formatDisplayAddress: (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`,
}));

import { useLeaderboard } from '../../app/lib/hooks/useLeaderboard';
const mockUseLeaderboard = vi.mocked(useLeaderboard);

const BETTOR_ADDR = 'GBETTOR1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const CREATOR_ADDR = 'GCREATOR1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const MOCK_BETTORS = [
  { address: BETTOR_ADDR, rank: 1, totalVolume: 12_500_000, wins: 32, totalPredictions: 47, winPercentage: 68.1 },
  { address: 'GBETTOR2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', rank: 2, totalVolume: 9_800_000, wins: 23, totalPredictions: 32, winPercentage: 71.9 },
];
const MOCK_CREATORS = [
  { address: CREATOR_ADDR, rank: 1, totalPools: 24, totalVolume: 45_000_000 },
];

function makeReturn(overrides: Partial<UseLeaderboardReturn> = {}): UseLeaderboardReturn {
  return { bettors: MOCK_BETTORS, creators: MOCK_CREATORS, userBettorRank: null, userCreatorRank: null, isLoading: false, error: null, refresh: vi.fn(), ...overrides };
}

describe('Leaderboard', () => {
  beforeEach(() => { mockUseLeaderboard.mockReturnValue(makeReturn()); });

  it('mounts and shows heading', () => {
    renderWithProviders(<Leaderboard />);
    expect(screen.getByRole('heading', { name: /leaderboard/i })).toBeInTheDocument();
  });

  it('shows Top Bettors tab selected by default', () => {
    renderWithProviders(<Leaderboard />);
    expect(screen.getByRole('tab', { name: /top bettors/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to Top Creators tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Leaderboard />);
    await user.click(screen.getByRole('tab', { name: /top creators/i }));
    expect(screen.getByRole('tab', { name: /top creators/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/pools created/i)).toBeInTheDocument();
  });

  it('highlights current user with (you) label', async () => {
    mockUseLeaderboard.mockReturnValue(makeReturn({ userBettorRank: 1 }));
    renderWithProviders(<Leaderboard currentUserAddress={BETTOR_ADDR} />);
    await waitFor(() => expect(screen.getByText('(you)')).toBeInTheDocument());
  });

  it('shows user rank badge when in top 100', () => {
    mockUseLeaderboard.mockReturnValue(makeReturn({ userBettorRank: 3 }));
    renderWithProviders(<Leaderboard currentUserAddress="GSOME" />);
    expect(screen.getByText(/#3/)).toBeInTheDocument();
  });

  it('shows loading skeleton when loading with no data', () => {
    mockUseLeaderboard.mockReturnValue(makeReturn({ isLoading: true, bettors: [], creators: [] }));
    renderWithProviders(<Leaderboard />);
    expect(screen.getByLabelText(/loading leaderboard/i)).toBeInTheDocument();
  });

  it('shows empty state when no bettors', () => {
    mockUseLeaderboard.mockReturnValue(makeReturn({ bettors: [] }));
    renderWithProviders(<Leaderboard />);
    expect(screen.getByText(/no bettors yet/i)).toBeInTheDocument();
  });

  it('shows error alert', () => {
    mockUseLeaderboard.mockReturnValue(makeReturn({ error: 'Failed to load leaderboard. Please try again.' }));
    renderWithProviders(<Leaderboard />);
    expect(screen.getByRole('alert')).toHaveTextContent(/failed to load/i);
  });

  it('calls refresh on button click', async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    mockUseLeaderboard.mockReturnValue(makeReturn({ refresh }));
    renderWithProviders(<Leaderboard />);
    await user.click(screen.getByRole('button', { name: /refresh leaderboard/i }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('disables refresh button while loading', () => {
    mockUseLeaderboard.mockReturnValue(makeReturn({ isLoading: true }));
    renderWithProviders(<Leaderboard />);
    expect(screen.getByRole('button', { name: /refresh leaderboard/i })).toBeDisabled();
  });
});
