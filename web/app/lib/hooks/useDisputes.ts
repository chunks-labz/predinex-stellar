'use client';

import { useState, useCallback } from 'react';

/**
 * Legacy dispute helper.
 *
 * The current Predinex Soroban contract exposes a frozen/disputed lifecycle
 * for pool state, but it does not support a full on-chain community dispute
 * voting mechanism. This hook preserves compatibility for UI state while the
 * contract-level dispute resolution contract is developed.
 */
export function useDisputes() {
  const [disputes, setDisputes] = useState<any[]>([]);
  const [votes, setVotes] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Client-side vote stub.
   *
   * This function does not call an on-chain dispute voting contract because the
   * current Predinex contract does not expose vote submission.
   * Future on-chain integration should replace this with a contract call to the
   * configured dispute contract principal and function.
   */
  const addVote = useCallback(
    async (disputeId: string, voter: string, vote: boolean, voterBalance: number) => {
      setIsLoading(true);
      try {
        if (voterBalance <= 0) {
          throw new Error('Insufficient balance to vote');
        }

        const voteRecord = {
          id: `vote-${Date.now()}`,
          disputeId,
          voter,
          vote,
          votingPower: Math.max(1, Math.floor(voterBalance / 10000000)),
          votedAt: Date.now(),
        };

        setVotes(prev => [...prev, voteRecord]);
        return voteRecord;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add vote';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const getDisputeVotes = useCallback(
    (disputeId: string) => votes.filter(v => v.disputeId === disputeId),
    [votes]
  );

  const getDisputeStats = useCallback(
    (disputeId: string) => {
      const disputeVotes = getDisputeVotes(disputeId);
      const votesFor = disputeVotes.filter(v => v.vote).reduce((sum, v) => sum + v.votingPower, 0);
      const votesAgainst = disputeVotes.filter(v => !v.vote).reduce((sum, v) => sum + v.votingPower, 0);

      return {
        totalVotes: disputeVotes.length,
        votesFor,
        votesAgainst,
        totalVotingPower: votesFor + votesAgainst,
      };
    },
    [getDisputeVotes]
  );

  const hasUserVoted = useCallback(
    (disputeId: string, voter: string) =>
      votes.some(v => v.disputeId === disputeId && v.voter === voter),
    [votes]
  );

  const getPoolDisputes = useCallback(
    (poolId: number) => disputes.filter(d => d.poolId === poolId),
    [disputes]
  );

  return {
    disputes,
    votes,
    isLoading,
    error,
    addVote,
    getDisputeVotes,
    getDisputeStats,
    getPoolDisputes,
    hasUserVoted,
  };
}
