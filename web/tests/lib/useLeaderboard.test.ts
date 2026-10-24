import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLeaderboard } from '../../app/lib/hooks/useLeaderboard';

describe('useLeaderboard', () => {
  it('does not invent an entry or rank for the connected wallet', async () => {
    const { result } = renderHook(() => useLeaderboard('GCONNECTEDWALLET'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Every user used to appear as #1 with made-up wins and volume.
    expect(result.current.bettors).toEqual([]);
    expect(result.current.creators).toEqual([]);
    expect(result.current.userBettorRank).toBeNull();
    expect(result.current.userCreatorRank).toBeNull();
  });
});
