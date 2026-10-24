'use client';

import type { ChangeEvent, FocusEvent } from 'react';
import type { CreatePoolDraft, FormErrors } from './useCreateWizard';
import { getHelpText, MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from '@/lib/validators';
import { useI18n } from '@/app/lib/i18n';

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
  const { t } = useI18n();

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
          {t('create.basics.titleLabel')}
        </label>
        <input
          id="title"
          name="title"
          type="text"
          value={draft.title}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={t('create.basics.titlePlaceholder')}
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
          {t('create.basics.descriptionLabel')}
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          value={draft.description}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={t('create.basics.descriptionPlaceholder')}
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
            {t('create.basics.categoryLabel')}
          </label>
          <select
            id="category"
            name="category"
            value={draft.category}
            onChange={onChange}
            className="w-full px-4 py-2 rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="crypto">{t('create.basics.categoryCrypto')}</option>
            <option value="sports">{t('create.basics.categorySports')}</option>
            <option value="politics">{t('create.basics.categoryPolitics')}</option>
            <option value="tech">{t('create.basics.categoryTech')}</option>
            <option value="weather">{t('create.basics.categoryWeather')}</option>
            <option value="finance">{t('create.basics.categoryFinance')}</option>
            <option value="other">{t('create.basics.categoryOther')}</option>
          </select>
        </div>

        <div>
          <label htmlFor="tags" className="block text-sm font-medium mb-1">
            {t('create.basics.tagsLabel')}
          </label>
          <input
            id="tags"
            name="tags"
            type="text"
            value={draft.tags}
            onChange={onChange}
            placeholder={t('create.basics.tagsPlaceholder')}
            className="w-full px-4 py-2 rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <p className="mt-1 text-xs text-muted-foreground">{t('create.basics.tagsHint')}</p>
        </div>
      </div>

      {/* Resolution Criteria */}
      <div>
        <label htmlFor="resolutionCriteria" className="block text-sm font-medium mb-1">
          {t('create.basics.resolutionLabel')}{' '}
          <span className="text-muted-foreground font-normal">{t('create.basics.resolutionOptional')}</span>
        </label>
        <textarea
          id="resolutionCriteria"
          name="resolutionCriteria"
          rows={3}
          value={draft.resolutionCriteria}
          onChange={onChange}
          placeholder={t('create.basics.resolutionPlaceholder')}
          className="w-full px-4 py-2 rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {t('create.basics.resolutionHint')}
        </p>
      </div>

      {/* Cover Image */}
      <div>
        <label htmlFor="coverImage" className="block text-sm font-medium mb-1">
          {t('create.basics.coverLabel')}{' '}
          <span className="text-muted-foreground font-normal">{t('create.basics.resolutionOptional')}</span>
        </label>
        <input
          id="coverImage"
          name="coverImage"
          type="url"
          value={draft.coverImage}
          onChange={onChange}
          placeholder={t('create.basics.coverPlaceholder')}
          className="w-full px-4 py-2 rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>
    </div>
  );
}
