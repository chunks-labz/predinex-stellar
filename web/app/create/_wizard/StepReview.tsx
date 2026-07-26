'use client';

import { Pencil } from 'lucide-react';
import MarketCard from '@/components/MarketCard';
import type { CreatePoolDraft, WizardStep } from './useCreateWizard';
import type { ProcessedMarket } from '../../lib/market-types';
import { parseTagsInput } from './pool-templates';

interface StepReviewProps {
  draft: CreatePoolDraft;
  walletAddress: string | null | undefined;
  onEdit: (step: WizardStep) => void;
  setField: (field: keyof CreatePoolDraft, value: string | boolean) => void;
}

function buildPreviewMarket(
  draft: CreatePoolDraft,
  walletAddress: string | null | undefined
): ProcessedMarket {
  const duration = parseInt(draft.duration, 10);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const [outcomeA, outcomeB] = draft.outcomes;
  return {
    poolId: -1,
    title: draft.title || 'Your pool title appears here',
    description: draft.description || 'Your description appears here.',
    outcomeA: outcomeA || 'Outcome 1',
    outcomeB: outcomeB || 'Outcome 2',
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

export function StepReview({ draft, walletAddress, onEdit, setField }: StepReviewProps) {
  const preview = buildPreviewMarket(draft, walletAddress);
  const tags = parseTagsInput(draft.tags);
  const templateLabel =
    draft.templateSource === 'blank'
      ? 'Blank configuration'
      : draft.templateSource === 'public'
        ? `Public template #${draft.templateId}`
        : `Saved template`;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border p-5 space-y-4">
        <SummaryRow label="Template" value={templateLabel} onEdit={() => onEdit(1)} />
        <SummaryRow label="Title" value={draft.title} onEdit={() => onEdit(2)} />
        <SummaryRow label="Description" value={draft.description} onEdit={() => onEdit(2)} />
        <SummaryRow label="Category" value={draft.category} onEdit={() => onEdit(2)} />
        {tags.length > 0 && (
          <SummaryRow label="Tags" value={tags.join(', ')} onEdit={() => onEdit(2)} />
        )}
        <SummaryRow
          label="Outcomes"
          value={draft.outcomes.filter(Boolean).join(' · ')}
          onEdit={() => onEdit(3)}
        />
        <SummaryRow
          label="Expiry"
          value={draft.duration ? `${draft.duration} seconds` : '—'}
          onEdit={() => onEdit(4)}
        />
        <SummaryRow
          label="Deposit deadline"
          value={draft.depositDeadline ? `${draft.depositDeadline} seconds` : '—'}
          onEdit={() => onEdit(4)}
        />
        <SummaryRow
          label="Protocol fee"
          value={draft.protocolFeeBps ? `${draft.protocolFeeBps} bps` : '—'}
          onEdit={() => onEdit(4)}
        />
        <SummaryRow
          label="Settlement"
          value={draft.settlementType}
          onEdit={() => onEdit(4)}
        />
        {draft.referenceLink && (
          <SummaryRow label="Reference" value={draft.referenceLink} onEdit={() => onEdit(4)} />
        )}
        {draft.resolutionCriteria && (
          <SummaryRow
            label="Resolution criteria"
            value={draft.resolutionCriteria}
            onEdit={() => onEdit(1)}
          />
        )}
        {draft.externalLinks && (
          <SummaryRow label="External links" value={draft.externalLinks} onEdit={() => onEdit(2)} />
        )}
        {draft.coverImage && (
          <SummaryRow label="Cover image" value={draft.coverImage} onEdit={() => onEdit(1)} />
        )}
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-border p-4 cursor-pointer">
        <input
          type="checkbox"
          checked={draft.saveAsTemplate}
          onChange={(e) => setField('saveAsTemplate', e.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="block text-sm font-medium">Save as template for reuse</span>
          <span className="block text-xs text-muted-foreground mt-1">
            Stores this configuration in your browser so you can start from it next time.
          </span>
        </span>
      </label>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Live preview
        </h3>
        <div className="pointer-events-none">
          <MarketCard market={preview} />
        </div>
        {draft.outcomes.length > 2 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Preview shows the first two outcomes; all {draft.outcomes.length} outcomes will be
            created on-chain.
          </p>
        )}
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
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
        <div className="text-sm break-words">
          {value || <span className="text-muted-foreground">—</span>}
        </div>
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
