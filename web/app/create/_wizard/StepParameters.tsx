'use client';

import type { ChangeEvent, FocusEvent } from 'react';
import type { CreateMarketDraft, FormErrors } from './useCreateWizard';
import { getHelpText, MIN_POOL_DURATION_SECS, MAX_POOL_DURATION_SECS } from '@/lib/validators';

interface StepParametersProps {
  draft: CreateMarketDraft;
  errors: FormErrors;
  touched: Record<string, boolean>;
  setField: (field: keyof CreateMarketDraft, value: string) => void;
  blurField: (field: keyof CreateMarketDraft) => void;
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
  const onChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setField(e.target.name as keyof CreateMarketDraft, e.target.value);
  };
  const onBlur = (e: FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    blurField(e.target.name as keyof CreateMarketDraft);
  };

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="duration" className="block text-sm font-medium mb-1">
          Duration (seconds)
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
            <span className="text-xs text-muted-foreground">
              {humanizeSeconds(draft.duration)}
            </span>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="category" className="block text-sm font-medium mb-1">
          Category
        </label>
        <select
          id="category"
          name="category"
          value={draft.category}
          onChange={onChange}
          className="w-full px-4 py-2 rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="crypto">Cryptocurrency</option>
          <option value="sports">Sports</option>
          <option value="politics">Politics</option>
          <option value="tech">Technology</option>
          <option value="weather">Weather</option>
          <option value="finance">Finance</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div>
        <label htmlFor="referenceLink" className="block text-sm font-medium mb-1">
          External reference link (optional)
        </label>
        <input
          id="referenceLink"
          name="referenceLink"
          type="url"
          value={draft.referenceLink}
          onChange={onChange}
          placeholder="https://example.com/data"
          className="w-full px-4 py-2 rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Link to supporting data or resolution criteria.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">Estimated network fee</p>
            <p className="text-xs text-muted-foreground mt-1">
              The exact fee is simulated on-chain before you sign. You&apos;ll see the final
              amount in the confirmation dialog.
            </p>
          </div>
          <span className="text-muted-foreground text-xs whitespace-nowrap">simulated at submit</span>
        </div>
      </div>
    </div>
  );
}
