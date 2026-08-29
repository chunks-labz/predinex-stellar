'use client';

import { Plus, Trash2 } from 'lucide-react';
import { MAX_OUTCOME_LENGTH, MAX_OUTCOMES, MIN_OUTCOMES, getHelpText } from '@/lib/validators';
import type { CreatePoolDraft, FormErrors } from './useCreateWizard';
import { useI18n } from '@/app/lib/i18n';

interface StepOutcomesProps {
  draft: CreatePoolDraft;
  errors: FormErrors;
  touched: Record<string, boolean>;
  setOutcome: (index: number, value: string) => void;
  addOutcome: () => void;
  removeOutcome: (index: number) => void;
}

export function StepOutcomes({
  draft,
  errors,
  touched,
  setOutcome,
  addOutcome,
  removeOutcome,
}: StepOutcomesProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('create.outcomes.hint')
          .replace('{min}', String(MIN_OUTCOMES))
          .replace('{max}', String(MAX_OUTCOMES))}
      </p>

      {errors.outcomes && (
        <p role="alert" className="text-sm text-red-500">
          {errors.outcomes}
        </p>
      )}

      <div className="space-y-3">
        {draft.outcomes.map((outcome, index) => {
          const fieldKey = `outcome_${index}`;
          const error = errors[fieldKey];
          const isTouched = touched[fieldKey];
          const placeholder =
            index === 0
              ? t('create.outcomes.placeholderYes')
              : index === 1
                ? t('create.outcomes.placeholderNo')
                : t('create.outcomes.placeholderGeneric');
          return (
            <div key={fieldKey} className="flex items-start gap-2">
              <div className="flex-1">
                <label htmlFor={fieldKey} className="block text-sm font-medium mb-1">
                  {t('create.outcomes.outcomeLabel').replace('{n}', String(index + 1))}
                </label>
                <input
                  id={fieldKey}
                  name={fieldKey}
                  type="text"
                  value={outcome}
                  onChange={(e) => setOutcome(index, e.target.value)}
                  placeholder={placeholder}
                  aria-invalid={!!error}
                  className={`w-full px-4 py-2 rounded-lg bg-background border focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                    isTouched && error ? 'border-red-500' : 'border-input'
                  }`}
                />
                <div className="flex justify-between items-center mt-1">
                  {error && isTouched ? (
                    <p role="alert" className="text-sm text-red-500">
                      {error}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{getHelpText('outcomeA')}</p>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {outcome.length}/{MAX_OUTCOME_LENGTH}
                  </span>
                </div>
              </div>
              {draft.outcomes.length > MIN_OUTCOMES && (
                <button
                  type="button"
                  onClick={() => removeOutcome(index)}
                  aria-label={t('create.outcomes.removeAriaLabel').replace('{n}', String(index + 1))}
                  className="mt-7 p-2 rounded-lg border border-border text-muted-foreground hover:text-red-500 hover:border-red-500/40"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {draft.outcomes.length < MAX_OUTCOMES && (
        <button
          type="button"
          onClick={addOutcome}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-border text-sm hover:bg-muted/30"
        >
          <Plus className="w-4 h-4" />
          {t('create.outcomes.addButton')}
        </button>
      )}
    </div>
  );
}
