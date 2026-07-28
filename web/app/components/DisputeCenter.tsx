'use client';

import { useState, useEffect } from 'react';
import { useDisputes } from '../lib/hooks/useDisputes';
import { AlertCircle, Vote, TrendingUp, Lock } from 'lucide-react';

interface DisputeCenterProps {
  poolId?: number;
  userId?: string;
  /** Voter's STX balance. Used to calculate voting power and validate eligibility.
   *  Defaults to 100 STX until wallet integration supplies the real value. */
  voterBalance?: number;
}

export default function DisputeCenter({ poolId, userId, voterBalance = 100 }: DisputeCenterProps) {
  const { disputes, getPoolDisputes, getDisputeStats, hasUserVoted, addVote } = useDisputes();
  const [selectedTab, setSelectedTab] = useState<'active' | 'resolved'>('active');
  const [selectedDispute, setSelectedDispute] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [votingDisputeId, setVotingDisputeId] = useState<string | null>(null);

  if (!poolId) {
    return (
      <div className="glass p-6 rounded-xl border border-border text-center">
        <AlertCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-muted-foreground">Select a pool to view disputes</p>
      </div>
    );
  }

  const poolDisputes = getPoolDisputes(poolId);
  const activeDisputes = poolDisputes.filter(d => d.status === 'active' || d.status === 'voting');
  const resolvedDisputes = poolDisputes.filter(d => d.status === 'resolved');

  const handleVote = (e: React.MouseEvent, disputeId: string, vote: boolean) => {
    // Prevent the card's onClick from toggling collapse while voting
    e.stopPropagation();
    if (!userId) return;

    setVoteError(null);
    setVotingDisputeId(disputeId);
    try {
      addVote(disputeId, userId, vote, voterBalance);
    } catch (err) {
      setVoteError(err instanceof Error ? err.message : 'Failed to cast vote');
    } finally {
      setVotingDisputeId(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
      case 'voting':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      case 'resolved':
        return 'bg-green-500/10 text-green-400 border-green-500/20';
      case 'rejected':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      default:
        return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    }
  };

  const getResolutionColor = (upheld: boolean | undefined) => {
    if (upheld === undefined) return '';
    return upheld
      ? 'bg-green-500/10 text-green-400 border-green-500/20'
      : 'bg-red-500/10 text-red-400 border-red-500/20';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass p-6 rounded-xl border border-border">
        <h2 className="text-2xl font-bold mb-2">Dispute Resolution</h2>
        <p className="text-muted-foreground">Challenge pool settlements through community voting</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass p-4 rounded-lg border border-border">
          <p className="text-sm text-muted-foreground">Total Disputes</p>
          <p className="text-2xl font-bold">{poolDisputes.length}</p>
        </div>
        <div className="glass p-4 rounded-lg border border-border">
          <p className="text-sm text-muted-foreground">Active</p>
          <p className="text-2xl font-bold text-yellow-400">{activeDisputes.length}</p>
        </div>
        <div className="glass p-4 rounded-lg border border-border">
          <p className="text-sm text-muted-foreground">Resolved</p>
          <p className="text-2xl font-bold text-green-400">{resolvedDisputes.length}</p>
        </div>
        <div className="glass p-4 rounded-lg border border-border">
          <p className="text-sm text-muted-foreground">Bond Locked</p>
          <p className="text-2xl font-bold text-blue-400">
            {poolDisputes.reduce((sum, d) => sum + d.bond, 0).toFixed(2)} STX
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-border">
        <button
          onClick={() => setSelectedTab('active')}
          className={`px-4 py-2 font-bold transition-all ${
            selectedTab === 'active'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Active ({activeDisputes.length})
        </button>
        <button
          onClick={() => setSelectedTab('resolved')}
          className={`px-4 py-2 font-bold transition-all ${
            selectedTab === 'resolved'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Resolved ({resolvedDisputes.length})
        </button>
      </div>

      {/* Content */}
      <div className="space-y-3">
        {selectedTab === 'active' && (
          <>
            {activeDisputes.length === 0 ? (
              <div className="glass p-6 rounded-xl border border-border text-center">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground">No active disputes</p>
              </div>
            ) : (
              activeDisputes.map(dispute => {
                const stats = getDisputeStats(dispute.id);
                const userVoted = userId ? hasUserVoted(dispute.id, userId) : false;

                return (
                  <div
                    key={dispute.id}
                    className={`glass p-4 rounded-lg border cursor-pointer transition-all hover:border-primary ${getStatusColor(
                      dispute.status
                    )}`}
                    onClick={() => setSelectedDispute(selectedDispute === dispute.id ? null : dispute.id)}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <p className="font-bold">Dispute #{dispute.id.slice(-6)}</p>
                        <p className="text-sm text-muted-foreground">{dispute.reason}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full border ${getStatusColor(dispute.status)}`}>
                        {dispute.status.toUpperCase()}
                      </span>
                    </div>

                    {selectedDispute === dispute.id && (
                      <div className="space-y-3 mt-4 pt-4 border-t border-current/20">
                        {/* Voting Stats */}
                        <div className="grid grid-cols-3 gap-2">
                          <div className="bg-muted/50 p-2 rounded">
                            <p className="text-xs text-muted-foreground">For</p>
                            <p className="font-bold text-green-400">{stats.votesFor}</p>
                          </div>
                          <div className="bg-muted/50 p-2 rounded">
                            <p className="text-xs text-muted-foreground">Against</p>
                            <p className="font-bold text-red-400">{stats.votesAgainst}</p>
                          </div>
                          <div className="bg-muted/50 p-2 rounded">
                            <p className="text-xs text-muted-foreground">Total</p>
                            <p className="font-bold">{stats.totalVotes}</p>
                          </div>
                        </div>

                        {/* Bond Info */}
                        <div className="flex items-center gap-2 text-sm">
                          <Lock className="w-4 h-4" />
                          <span>Bond: {dispute.bond.toFixed(2)} STX</span>
                        </div>

                        {/* Vote Button */}
                        {userId && !userVoted && (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <button
                                onClick={(e) => handleVote(e, dispute.id, true)}
                                disabled={votingDisputeId === dispute.id}
                                className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded transition-all"
                              >
                                <Vote className="w-4 h-4 inline mr-1" />
                                Uphold
                              </button>
                              <button
                                onClick={(e) => handleVote(e, dispute.id, false)}
                                disabled={votingDisputeId === dispute.id}
                                className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded transition-all"
                              >
                                <Vote className="w-4 h-4 inline mr-1" />
                                Reject
                              </button>
                            </div>
                            {voteError && selectedDispute === dispute.id && (
                              <p className="text-xs text-red-400 text-center flex items-center justify-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                {voteError}
                              </p>
                            )}
                          </div>
                        )}

                        {userVoted && (
                          <p className="text-xs text-muted-foreground text-center">✓ You have voted</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {selectedTab === 'resolved' && (
          <>
            {resolvedDisputes.length === 0 ? (
              <div className="glass p-6 rounded-xl border border-border text-center">
                <TrendingUp className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground">No resolved disputes</p>
              </div>
            ) : (
              resolvedDisputes.map(dispute => (
                <div
                  key={dispute.id}
                  className={`glass p-4 rounded-lg border ${getResolutionColor(dispute.resolution)}`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-bold">Dispute #{dispute.id.slice(-6)}</p>
                      <p className="text-sm text-muted-foreground">{dispute.reason}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full border ${getResolutionColor(dispute.resolution)}`}>
                      {dispute.resolution ? 'UPHELD' : 'REJECTED'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Resolved: {new Date(dispute.resolvedAt || 0).toLocaleDateString()}
                  </p>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* Info */}
      <div className="glass p-4 rounded-lg border border-border/50 bg-primary/5">
        <p className="text-sm text-muted-foreground">
          💡 Disputes allow the community to challenge pool settlements. Vote with your STX balance to uphold or reject disputes.
        </p>
      </div>
    </div>
  );
}
