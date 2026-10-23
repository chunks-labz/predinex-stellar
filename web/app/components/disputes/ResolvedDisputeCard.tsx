import { TOKEN_SYMBOL } from '@/app/lib/formatting';
import type { Dispute } from '@/app/lib/disputes/types';
import { formatDisputeAddress, formatMicroStx } from '@/app/lib/disputes/formatting';

interface ResolvedDisputeCardProps {
  dispute: Dispute;
}

export function ResolvedDisputeCard({ dispute }: ResolvedDisputeCardProps) {
  return (
    <div className="glass p-6 rounded-xl">
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="font-mono text-sm">Dispute #{dispute.id}</span>
            <span
              className={`px-2 py-1 rounded text-xs ${
                dispute.resolution ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
              }`}
            >
              {dispute.resolution ? 'Upheld' : 'Rejected'}
            </span>
          </div>
          <h4 className="font-semibold text-lg mb-1">{dispute.poolTitle}</h4>
          <div className="text-sm text-muted-foreground">
            Pool #{dispute.poolId} • Disputed by {formatDisputeAddress(dispute.disputer)}
          </div>
        </div>

        <div className="text-right">
          <div className="text-sm font-semibold">{formatMicroStx(dispute.disputeBond)} {TOKEN_SYMBOL} bond</div>
          <div className="text-xs text-muted-foreground">
            {dispute.resolution ? 'Refunded' : 'Forfeited'}
          </div>
        </div>
      </div>

      <div className="mb-4">
        <div className="text-sm text-muted-foreground bg-muted p-3 rounded">{dispute.disputeReason}</div>
      </div>

      <div className="flex justify-between items-center">
        <div className="flex space-x-6">
          <div>
            <div className="text-sm text-muted-foreground">Final Votes For</div>
            <div className="text-lg font-semibold text-green-500">{dispute.votesFor}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Final Votes Against</div>
            <div className="text-lg font-semibold text-red-500">{dispute.votesAgainst}</div>
          </div>
        </div>

        <div className="text-sm text-muted-foreground">
          Resolved {(() => {
            let ts = dispute.createdAt;
            if (ts > 0 && ts < 1_000_000_000_000) ts = ts * 1000;
            return new Date(ts).toLocaleDateString();
          })()}
        </div>
      </div>
    </div>
  );
}
