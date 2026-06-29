'use client';

import type { ChangeEvent, FocusEvent } from 'react';
import type { CreateMarketDraft, FormErrors } from './useCreateWizard';
import { getHelpText } from '@/lib/validators';

const MAX_TITLE = 100;
const MAX_DESCRIPTION = 500;
const MAX_OUTCOME = 50;

interface StepQuestionProps {
  draft: CreateMarketDraft;
  errors: FormErrors;
  touched: Record<string, boolean>;
  setField: (field: keyof CreateMarketDraft, value: string) => void;
  blurField: (field: keyof CreateMarketDraft) => void;
}

function charCount(value: string, max: number) {
  const overflow = value.length > max;
  const near = value.length > max * 0.9;
  return (
    <span
      className={`text-xs ${
        overflow ? 'text-red-500' : near ? 'text-orange-500' : 'text-muted-foreground'
      }`}
    >
      {value.length}/{max}
    </span>
  );
}

export function StepQuestion({
  draft,
  errors,
  touched,
  setField,
  blurField,
}: StepQuestionProps) {
  const onChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setField(e.target.name as keyof CreateMarketDraft, e.target.value);
  };
  const onBlur = (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    blurField(e.target.name as keyof CreateMarketDraft);
  };

  return (
    <div className="space-y-5">
      {/* Title */}
      <div>
        <label htmlFor="title" className="block text-sm font-medium mb-1">
          Question / Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          value={draft.title}
          onChange={onChange}
          onBlur={onBlur}
          placeholder="e.g. Will Bitcoin be above $100k by end of 2025?"
          autoComplete="off"
          aria-describedby={errors.title ? 'title-error' : 'title-help'}
          aria-invalid={!!errors.title}
          className={`w-full px-4 py-2 rounded-lg bg-background border focus:outline-none focus:ring-2 focus:ring-primary/50 ${
            touched.title && errors.title ? 'border-red-500' : 'border-input'
          }`}
        />
        <div className="flex justify-between items-center mt-1">
          {errors.title && touched.title ? (
            <p id="title-error" role="alert" className="text-sm text-red-500">
              {errors.title}
            </p>
          ) : (
            <p id="title-help" className="text-xs text-muted-foreground">
              {getHelpText('title')}
            </p>
          )}
          {charCount(draft.title, MAX_TITLE)}
        </div>
      </div>

      {/* Description */}
      <div>
        <label htmlFor="description" className="block text-sm font-medium mb-1">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          value={draft.description}
          onChange={onChange}
          onBlur={onBlur}
          placeholder="Provide context and resolution criteria for this market."
          aria-describedby={errors.description ? 'description-error' : 'description-help'}
          aria-invalid={!!errors.description}
          className={`w-full px-4 py-2 rounded-lg bg-background border focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none ${
            touched.description && errors.description ? 'border-red-500' : 'border-input'
          }`}
        />
        <div className="flex justify-between items-center mt-1">
          {errors.description && touched.description ? (
            <p id="description-error" role="alert" className="text-sm text-red-500">
              {errors.description}
            </p>
          ) : (
            <p id="description-help" className="text-xs text-muted-foreground">
              {getHelpText('description')}
            </p>
          )}
          {charCount(draft.description, MAX_DESCRIPTION)}
        </div>
      </div>

      {/* Outcomes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(['outcomeA', 'outcomeB'] as const).map((field) => (
          <div key={field}>
            <label htmlFor={field} className="block text-sm font-medium mb-1">
              Outcome {field === 'outcomeA' ? 'A' : 'B'}
            </label>
            <input
              id={field}
              name={field}
              type="text"
              value={draft[field]}
              onChange={onChange}
              onBlur={onBlur}
              placeholder={field === 'outcomeA' ? 'e.g. Yes' : 'e.g. No'}
              aria-describedby={errors[field] ? `${field}-error` : `${field}-help`}
              aria-invalid={!!errors[field]}
              className={`w-full px-4 py-2 rounded-lg bg-background border focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                touched[field] && errors[field] ? 'border-red-500' : 'border-input'
              }`}
            />
            <div className="flex justify-between items-center mt-1">
              {errors[field] && touched[field] ? (
                <p id={`${field}-error`} role="alert" className="text-sm text-red-500">
                  {errors[field]}
                </p>
              ) : (
                <p id={`${field}-help`} className="text-xs text-muted-foreground">
                  {getHelpText(field)}
                </p>
              )}
              {charCount(draft[field], MAX_OUTCOME)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
