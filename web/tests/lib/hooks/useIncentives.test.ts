import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIncentives } from '@/app/lib/hooks/useIncentives';
import { BetterIncentive } from '@/app/lib/liquidity-incentives';

describe('useIncentives hook', () => {
  it('assigns stable IDs and claims the correct incentive when using filtered list', () => {
    const { result } = renderHook(() => useIncentives());

    const initialIncentives: BetterIncentive[] = [
      {
        id: 'inc-A',
        betterId: 'user1',
        poolId: 1,
        betAmount: 100,
        bonusAmount: 10,
        bonusType: 'early-bird',
        status: 'pending',
      },
      {
        id: 'inc-B',
        betterId: 'user1',
        poolId: 2,
        betAmount: 200,
        bonusAmount: 20,
        bonusType: 'volume',
        status: 'claimed',
        claimedAt: 1600000000,
      },
      {
        id: 'inc-C',
        betterId: 'user1',
        poolId: 3,
        betAmount: 300,
        bonusAmount: 30,
        bonusType: 'loyalty',
        status: 'pending',
      },
    ];

    act(() => {
      result.current.setIncentives(initialIncentives);
    });

    // Verify initial state
    const pendingBefore = result.current.getPendingIncentives('user1');
    expect(pendingBefore).toHaveLength(2);
    expect(pendingBefore[0].id).toBe('inc-A');
    expect(pendingBefore[1].id).toBe('inc-C');

    const claimedBefore = result.current.getClaimedIncentives('user1');
    expect(claimedBefore).toHaveLength(1);
    expect(claimedBefore[0].id).toBe('inc-B');

    // Issue 858 scenario: in pending list [inc-A, inc-C], inc-C is at filtered index 1,
    // but in the full array [inc-A, inc-B, inc-C], index 1 is inc-B (already claimed).
    // When claiming inc-C by its stable ID:
    act(() => {
      result.current.claimIncentive(pendingBefore[1].id!);
    });

    // Verify results
    const pendingAfter = result.current.getPendingIncentives('user1');
    expect(pendingAfter).toHaveLength(1);
    expect(pendingAfter[0].id).toBe('inc-A');

    const claimedAfter = result.current.getClaimedIncentives('user1');
    expect(claimedAfter).toHaveLength(2);
    expect(claimedAfter.map(i => i.id)).toEqual(['inc-B', 'inc-C']);
    expect(claimedAfter.find(i => i.id === 'inc-C')?.status).toBe('claimed');
  });

  it('calculates total pending and claimed bonus accurately', () => {
    const { result } = renderHook(() => useIncentives());

    const testIncentives: BetterIncentive[] = [
      {
        id: 'inc-1',
        betterId: 'user2',
        poolId: 10,
        betAmount: 50,
        bonusAmount: 5,
        bonusType: 'early-bird',
        status: 'pending',
      },
      {
        id: 'inc-2',
        betterId: 'user2',
        poolId: 10,
        betAmount: 150,
        bonusAmount: 15,
        bonusType: 'volume',
        status: 'claimed',
      },
    ];

    act(() => {
      result.current.setIncentives(testIncentives);
    });

    expect(result.current.getTotalPendingBonus('user2')).toBe(5);
    expect(result.current.getTotalClaimedBonus('user2')).toBe(15);
  });
});
