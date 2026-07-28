'use client';

import type { ChangeEvent, FocusEvent } from 'react';
import type { CreatePoolDraft, FormErrors } from './useCreateWizard';
import { getHelpText, MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from '@/lib/validators';

interface StepBasicsProps {
  draft: CreatePoolDraft;
  errors: FormErrors;
  touched: Record<string, boolean>;
  setField: (field: keyof CreatePoolDraft, value: string | boolean) => void;
  blurField: (field: keyof CreatePoolDraft) => void;
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

export function StepBasics({
  draft,
  errors,
  touched,
  setField,
  blurField,
}: StepBasicsProps) {
  const onChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setField(e.target.name as keyof CreatePoolDraft, e.target.value);
  };
  const onBlur = (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    blurField(e.target.name as keyof CreatePoolDraft);
  };

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="title" className="block text-sm font-medium mb-1">
          Pool title
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
          {charCount(draft.title, MAX_TITLE_LENGTH)}
        </div>
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium mb-1">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          value={draft.description}
          onChange={onChange}
          onBlur={onBlur}
          placeholder="Provide context, resolution criteria, and data sources."
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
          {charCount(draft.description, MAX_DESCRIPTION_LENGTH)}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <label htmlFor="tags" className="block text-sm font-medium mb-1">
            Tags
          </label>
          <input
            id="tags"
            name="tags"
            type="text"
            value={draft.tags}
            onChange={onChange}
            placeholder="weekly, btc, price"
            className="w-full px-4 py-2 rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <p className="mt-1 text-xs text-muted-foreground">Comma-separated labels for discovery.</p>
        </div>
      </div>

      {/* Resolution Criteria */}
      <div>
        <label htmlFor="resolutionCriteria" className="block text-sm font-medium mb-1">
          Resolution criteria <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <textarea
          id="resolutionCriteria"
          name="resolutionCriteria"
          rows={3}
          value={draft.resolutionCriteria}
          onChange={onChange}
          placeholder="Describe exactly what determines each outcome. Markdown supported."
          className="w-full px-4 py-2 rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Immutable once the first bet is placed.
        </p>
      </div>

      {/* Cover Image */}
      <div>
        <label htmlFor="coverImage" className="block text-sm font-medium mb-1">
          Cover image URL <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          id="coverImage"
          name="coverImage"
          type="url"
          value={draft.coverImage}
          onChange={onChange}
          placeholder="https://example.com/image.png"
          className="w-full px-4 py-2 rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>
    </div>
  );
}
