'use client';
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('useDisputeManagement');

import { useState, useEffect, useCallback } from 'react';
import { useDisputes } from '../hooks/useDisputes';
import type { Dispute, DisputeVote, DisputeTabId } from './types';
import { fetchDisputesFromContract } from './fetchDisputesFromContract';
import { getMockDisputes } from './mockDisputes';
import { isDisputeMockDataEnabled } from '../feature-flags';

export function useDisputeManagement(userAddress: string | null | undefined) {
  const { addVote } = useDisputes();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [userVotes, setUserVotes] = useState<DisputeVote[]>([]);
  const [selectedTab, setSelectedTab] = useState<DisputeTabId>('active');
  const [isLoading, setIsLoading] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function loadDisputes() {
      setIsLoading(true);
      try {
        const fetchedDisputes = await fetchDisputesFromContract();
        if (fetchedDisputes.length > 0) {
          setDisputes(fetchedDisputes);
        } else if (isDisputeMockDataEnabled()) {
          setDisputes(getMockDisputes());
        } else {
          setDisputes([]);
        }
      } catch (error) {
        log.error('Error loading disputes:', error);
        setDisputes([]);
      } finally {
        setIsLoading(false);
      }
    }
    void loadDisputes();
  }, []);

  const hasUserVoted = useCallback(
    (disputeId: number) => userVotes.some((vote) => vote.disputeId === disputeId),
    [userVotes]
  );

  const getUserVote = useCallback(
    (disputeId: number) => userVotes.find((vote) => vote.disputeId === disputeId),
    [userVotes]
  );

  /**
   * Records a local vote for UI display.
   *
   * The underlying Predinex Soroban contract currently does not expose a
   * community dispute-voting transaction. This hook preserves local vote state
   * until a dedicated on-chain dispute contract is implemented.
   */
  const handleVote = useCallback(
    async (disputeId: number, vote: boolean) => {
      if (!userAddress) return;
      setIsLoading(true);

      try {
        const voteData = await addVote(disputeId.toString(), userAddress, vote, 1_000_000);
        if (voteData) {
          const newVote: DisputeVote = {
            disputeId,
            voter: userAddress,
            vote,
            votedAt: Date.now(),
          };
          setUserVotes((prev) => [...prev, newVote]);

          setDisputes((prev) =>
            prev.map((d) => {
              if (d.id === disputeId) {
                return {
                  ...d,
                  votesFor: vote ? d.votesFor + 1 : d.votesFor,
                  votesAgainst: !vote ? d.votesAgainst + 1 : d.votesAgainst,
                };
              }
              return d;
            })
          );
        }
      } catch (error) {
        log.error('Failed to cast vote:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [userAddress, addVote]
  );

  return {
    disputes,
    selectedTab,
    setSelectedTab,
    isLoading,
    now,
    hasUserVoted,
    getUserVote,
    handleVote,
  };
}
