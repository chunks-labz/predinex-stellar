'use client';

import type { ChangeEvent, FocusEvent } from 'react';
import type { CreatePoolDraft, FormErrors } from './useCreateWizard';
import {
  getHelpText,
  MAX_POOL_DURATION_SECS,
  MIN_POOL_DURATION_SECS,
  SETTLEMENT_TYPES,
} from '@/lib/validators';
import { useFeePreview } from '@/app/lib/hooks/useFeePreview';

interface StepParametersProps {
  draft: CreatePoolDraft;
  errors: FormErrors;
  touched: Record<string, boolean>;
  setField: (field: keyof CreatePoolDraft, value: string | boolean) => void;
  blurField: (field: keyof CreatePoolDraft) => void;
}

function humanizeSeconds(rawDuration: string): string {
  const seconds = parseInt(rawDuration, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${seconds} sec`;
  const minutes = seconds / 60;
  if (minutes < 60) return `≈ ${minutes.toFixed(1).replace(/\.0$/, '')} min`;
  const hours = minutes / 60;
  if (hours < 24) return `≈ ${hours.toFixed(1).replace(/\.0$/, '')} hr`;
  const days = hours / 24;
  return `≈ ${days.toFixed(1).replace(/\.0$/, '')} day${days >= 2 ? 's' : ''}`;
}

export function StepParameters({
  draft,
  errors,
  touched,
  setField,
  blurField,
}: StepParametersProps) {
  const feePreview = useFeePreview(draft.title, draft.description);

  const onChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setField(e.target.name as keyof CreatePoolDraft, e.target.value);
  };
  const onBlur = (e: FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    blurField(e.target.name as keyof CreatePoolDraft);
  };

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="duration" className="block text-sm font-medium mb-1">
          Pool expiry (seconds)
        </label>
        <input
          id="duration"
          name="duration"
          type="number"
          min={MIN_POOL_DURATION_SECS}
          max={MAX_POOL_DURATION_SECS}
          value={draft.duration}
          onChange={onChange}
          onBlur={onBlur}
          placeholder="e.g. 86400 (1 day)"
          aria-describedby={errors.duration ? 'duration-error' : 'duration-help'}
          aria-invalid={!!errors.duration}
          className={`w-full px-4 py-2 rounded-lg bg-background border focus:outline-none focus:ring-2 focus:ring-primary/50 ${
            touched.duration && errors.duration ? 'border-red-500' : 'border-input'
          }`}
        />
        <div className="flex justify-between items-center mt-1">
          {errors.duration && touched.duration ? (
            <p id="duration-error" role="alert" className="text-sm text-red-500">
              {errors.duration}
            </p>
          ) : (
            <p id="duration-help" className="text-xs text-muted-foreground">
              {getHelpText('duration')} ({MIN_POOL_DURATION_SECS}–
              {MAX_POOL_DURATION_SECS.toLocaleString()})
            </p>
          )}
          {humanizeSeconds(draft.duration) && (
            <span className="text-xs text-muted-foreground">{humanizeSeconds(draft.duration)}</span>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="depositDeadline" className="block text-sm font-medium mb-1">
          Deposit deadline (seconds)
        </label>
        <input
          id="depositDeadline"
          name="depositDeadline"
          type="number"
          min={MIN_POOL_DURATION_SECS}
          value={draft.depositDeadline}
          onChange={onChange}
          onBlur={onBlur}
          placeholder="e.g. 82800 (stop deposits 1 hr before expiry)"
          aria-describedby={
            errors.depositDeadline ? 'deposit-deadline-error' : 'deposit-deadline-help'
          }
          aria-invalid={!!errors.depositDeadline}
          className={`w-full px-4 py-2 rounded-lg bg-background border focus:outline-none focus:ring-2 focus:ring-primary/50 ${
            touched.depositDeadline && errors.depositDeadline ? 'border-red-500' : 'border-input'
          }`}
        />
        <div className="flex justify-between items-center mt-1">
          {errors.depositDeadline && touched.depositDeadline ? (
            <p id="deposit-deadline-error" role="alert" className="text-sm text-red-500">
              {errors.depositDeadline}
            </p>
          ) : (
            <p id="deposit-deadline-help" className="text-xs text-muted-foreground">
              {getHelpText('depositDeadline')}
            </p>
          )}
          {humanizeSeconds(draft.depositDeadline) && (
            <span className="text-xs text-muted-foreground">
              {humanizeSeconds(draft.depositDeadline)}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="protocolFeeBps" className="block text-sm font-medium mb-1">
            Protocol fee (basis points)
          </label>
          <input
            id="protocolFeeBps"
            name="protocolFeeBps"
            type="number"
            min={0}
            max={1000}
            value={draft.protocolFeeBps}
            onChange={onChange}
            onBlur={onBlur}
            aria-describedby={errors.protocolFeeBps ? 'fee-error' : 'fee-help'}
            aria-invalid={!!errors.protocolFeeBps}
            className={`w-full px-4 py-2 rounded-lg bg-background border focus:outline-none focus:ring-2 focus:ring-primary/50 ${
              touched.protocolFeeBps && errors.protocolFeeBps ? 'border-red-500' : 'border-input'
            }`}
          />
          <p id="fee-help" className="mt-1 text-xs text-muted-foreground">
            {getHelpText('protocolFeeBps')}
          </p>
          {errors.protocolFeeBps && touched.protocolFeeBps && (
            <p id="fee-error" role="alert" className="text-sm text-red-500">
              {errors.protocolFeeBps}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="settlementType" className="block text-sm font-medium mb-1">
            Settlement type
          </label>
          <select
            id="settlementType"
            name="settlementType"
            value={draft.settlementType}
            onChange={onChange}
            onBlur={onBlur}
            className={`w-full px-4 py-2 rounded-lg bg-background border focus:outline-none focus:ring-2 focus:ring-primary/50 ${
              touched.settlementType && errors.settlementType ? 'border-red-500' : 'border-input'
            }`}
          >
            {SETTLEMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type === 'oracle' ? 'Oracle' : type === 'twap' ? 'TWAP' : 'Manual'}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">{getHelpText('settlementType')}</p>
        </div>
      </div>

      <div>
        <label htmlFor="externalLinks" className="block text-sm font-medium mb-1">
          External links <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          id="externalLinks"
          name="externalLinks"
          type="url"
          value={draft.externalLinks}
          onChange={onChange}
          placeholder="https://example.com/data"
          className="w-full px-4 py-2 rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Reference URLs (pipe-separated for multiple). Immutable once the first bet is placed.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm space-y-2">
        <p className="font-medium">Estimated fees</p>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Protocol fee</span>
          <span>{feePreview.protocolFee} XLM</span>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Network fee (simulated)</span>
          <span>{feePreview.networkFee} XLM</span>
        </div>
        <div className="flex justify-between text-sm font-semibold pt-1 border-t border-border">
          <span>Total estimate</span>
          <span>{feePreview.total} XLM</span>
        </div>
      </div>
    </div>
  );
}
