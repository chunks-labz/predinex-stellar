import { TOKEN_SYMBOL } from '@/app/lib/formatting';
import type { Dispute, DisputeVote } from '@/app/lib/disputes/types';
import {
  formatDisputeAddress,
  formatMicroStx,
  formatVotingTimeRemaining,
} from '@/app/lib/disputes/formatting';

interface ActiveDisputeCardProps {
  dispute: Dispute;
  now: number;
  isLoading: boolean;
  userVote: DisputeVote | undefined;
  canVote: boolean;
  onVoteFor: () => void;
  onVoteAgainst: () => void;
}

export function ActiveDisputeCard({
  dispute,
  now,
  isLoading,
  userVote,
  canVote,
  onVoteFor,
  onVoteAgainst,
}: ActiveDisputeCardProps) {
  return (
    <div className="glass p-6 rounded-xl">
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="font-mono text-sm">Dispute #{dispute.id}</span>
            <span className="px-2 py-1 bg-orange-500/10 text-orange-500 rounded text-xs">Active</span>
          </div>
          <h4 className="font-semibold text-lg mb-1">{dispute.poolTitle}</h4>
          <div className="text-sm text-muted-foreground">
            Pool #{dispute.poolId} • Disputed by {formatDisputeAddress(dispute.disputer)}
          </div>
        </div>

        <div className="text-right">
          <div className="text-sm font-semibold">{formatMicroStx(dispute.disputeBond)} {TOKEN_SYMBOL} bond</div>
          <div className="text-xs text-muted-foreground">
            {formatVotingTimeRemaining(dispute.votingDeadline, now)}
          </div>
        </div>
      </div>

      <div className="mb-4">
        <div className="text-sm font-medium mb-2">Dispute Reason:</div>
        <div className="text-sm text-muted-foreground bg-muted p-3 rounded">{dispute.disputeReason}</div>
      </div>

      <div className="flex justify-between items-center mb-4">
        <div className="flex space-x-6">
          <div>
            <div className="text-sm text-muted-foreground">Votes For</div>
            <div className="text-lg font-semibold text-green-500">{dispute.votesFor}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Votes Against</div>
            <div className="text-lg font-semibold text-red-500">{dispute.votesAgainst}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Current Outcome</div>
            <div
              className={`text-sm font-semibold ${
                dispute.votesFor > dispute.votesAgainst
                  ? 'text-green-500'
                  : dispute.votesAgainst > dispute.votesFor
                    ? 'text-red-500'
                    : 'text-muted-foreground'
              }`}
            >
              {dispute.votesFor > dispute.votesAgainst
                ? 'Upheld'
                : dispute.votesAgainst > dispute.votesFor
                  ? 'Rejected'
                  : 'Tie'}
            </div>
          </div>
        </div>
      </div>

      {userVote ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">You voted:</span>
          <span className={`font-semibold ${userVote.vote ? 'text-green-500' : 'text-red-500'}`}>
            {userVote.vote ? 'FOR' : 'AGAINST'}
          </span>
        </div>
      ) : canVote ? (
        <div className="flex space-x-3">
          <button
            type="button"
            onClick={onVoteFor}
            disabled={isLoading}
            className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
          >
            Vote FOR Dispute
          </button>
          <button
            type="button"
            onClick={onVoteAgainst}
            disabled={isLoading}
            className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
          >
            Vote AGAINST Dispute
          </button>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">Voting period has ended</div>
      )}
    </div>
  );
}
