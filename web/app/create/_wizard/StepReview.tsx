'use client';

import { Pencil } from 'lucide-react';
import MarketCard from '@/components/MarketCard';
import type { CreateMarketDraft } from './useCreateWizard';
import type { ProcessedMarket } from '../../lib/market-types';

interface StepReviewProps {
  draft: CreateMarketDraft;
  walletAddress: string | null | undefined;
  onEdit: (step: 1 | 2) => void;
}

function buildPreviewMarket(
  draft: CreateMarketDraft,
  walletAddress: string | null | undefined
): ProcessedMarket {
  const duration = parseInt(draft.duration, 10);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return {
    poolId: -1,
    title: draft.title || 'Your question appears here',
    description: draft.description || 'Your description appears here.',
    outcomeA: draft.outcomeA || 'Outcome A',
    outcomeB: draft.outcomeB || 'Outcome B',
    totalVolume: 0,
    oddsA: 50,
    oddsB: 50,
    status: 'active',
    timeRemaining: safeDuration,
    createdAt: Math.floor(Date.now() / 1000),
    settledAt: null,
    creator: walletAddress || 'GPREVIEW',
  };
}

export function StepReview({ draft, walletAddress, onEdit }: StepReviewProps) {
  const preview = buildPreviewMarket(draft, walletAddress);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border p-5 space-y-4">
        <SummaryRow label="Question" value={draft.title} onEdit={() => onEdit(1)} />
        <SummaryRow label="Description" value={draft.description} onEdit={() => onEdit(1)} />
        <SummaryRow
          label="Outcomes"
          value={`${draft.outcomeA} vs ${draft.outcomeB}`}
          onEdit={() => onEdit(1)}
        />
        <SummaryRow
          label="Duration"
          value={draft.duration ? `${draft.duration} seconds` : '—'}
          onEdit={() => onEdit(2)}
        />
        <SummaryRow label="Category" value={draft.category} onEdit={() => onEdit(2)} />
        {draft.referenceLink && (
          <SummaryRow
            label="Reference link"
            value={draft.referenceLink}
            onEdit={() => onEdit(2)}
          />
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Live preview
        </h3>
        <div className="pointer-events-none">
          <MarketCard market={preview} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          This is how your pool will appear on the markets page. Final on-chain values
          (odds, volume, participants) will start at zero.
        </p>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          {label}
        </div>
        <div className="text-sm break-words">{value || <span className="text-muted-foreground">—</span>}</div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
      >
        <Pencil className="w-3 h-3" />
        Edit
      </button>
    </div>
  );
}
