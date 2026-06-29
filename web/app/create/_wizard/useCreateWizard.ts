'use client';

import { useCallback, useMemo, useState } from 'react';
import { useLocalStorage } from '../../lib/hooks/useLocalStorage';
import { validateField, validatePoolCreationForm } from '@/lib/validators';

export const CREATE_MARKET_DRAFT_KEY = 'predinex_create_market_draft_v1';

export interface CreateMarketDraft {
  title: string;
  description: string;
  outcomeA: string;
  outcomeB: string;
  duration: string;
  category: string;
  referenceLink: string;
}

export const EMPTY_DRAFT: CreateMarketDraft = {
  title: '',
  description: '',
  outcomeA: '',
  outcomeB: '',
  duration: '',
  category: 'crypto',
  referenceLink: '',
};

export type FormErrors = Partial<Record<keyof CreateMarketDraft, string>>;

export type WizardStep = 1 | 2 | 3;

const STEP_FIELDS: Record<WizardStep, Array<keyof CreateMarketDraft>> = {
  1: ['title', 'description', 'outcomeA', 'outcomeB'],
  2: ['duration'],
  3: [],
};

export interface UseCreateWizard {
  step: WizardStep;
  draft: CreateMarketDraft;
  errors: FormErrors;
  touched: Record<string, boolean>;
  setField: (field: keyof CreateMarketDraft, value: string) => void;
  blurField: (field: keyof CreateMarketDraft) => void;
  validateStep: (step: WizardStep) => boolean;
  next: () => void;
  prev: () => void;
  goTo: (step: WizardStep) => void;
  canAdvance: boolean;
  isFinalStep: boolean;
  resetDraft: () => void;
  /** Full final-form validation; returns errors so the submit handler can surface them. */
  validateAll: () => { valid: boolean; errors: FormErrors };
}

export function useCreateWizard(): UseCreateWizard {
  const [draft, setDraft, clearDraft] = useLocalStorage<CreateMarketDraft>(
    CREATE_MARKET_DRAFT_KEY,
    EMPTY_DRAFT
  );
  const [step, setStep] = useState<WizardStep>(1);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const setField = useCallback(
    (field: keyof CreateMarketDraft, value: string) => {
      setDraft((prev) => ({ ...prev, [field]: value }));
      const error = validateField(field, value);
      setErrors((prev) => ({ ...prev, [field]: error }));
    },
    [setDraft]
  );

  const blurField = useCallback(
    (field: keyof CreateMarketDraft) => {
      setTouched((prev) => ({ ...prev, [field]: true }));
      const error = validateField(field, draft[field] ?? '');
      setErrors((prev) => ({ ...prev, [field]: error }));
    },
    [draft]
  );

  const validateStep = useCallback(
    (target: WizardStep): boolean => {
      const fields = STEP_FIELDS[target];
      const nextErrors: FormErrors = {};
      const nextTouched: Record<string, boolean> = {};
      for (const field of fields) {
        const raw = draft[field] ?? '';
        const error = validateField(field, raw);
        nextTouched[field] = true;
        if (error) nextErrors[field] = error;
      }
      // Step 1 also requires the two outcomes to differ.
      if (target === 1 && draft.outcomeA.trim() && draft.outcomeB.trim()) {
        if (draft.outcomeA.trim().toLowerCase() === draft.outcomeB.trim().toLowerCase()) {
          nextErrors.outcomeB = 'Outcomes must be different';
        }
      }
      setErrors((prev) => ({ ...prev, ...nextErrors }));
      setTouched((prev) => ({ ...prev, ...nextTouched }));
      return Object.keys(nextErrors).length === 0;
    },
    [draft]
  );

  const canAdvance = useMemo(() => {
    const fields = STEP_FIELDS[step];
    for (const field of fields) {
      const raw = draft[field] ?? '';
      if (validateField(field, raw)) return false;
    }
    if (step === 1) {
      if (
        draft.outcomeA.trim() &&
        draft.outcomeB.trim() &&
        draft.outcomeA.trim().toLowerCase() === draft.outcomeB.trim().toLowerCase()
      ) {
        return false;
      }
    }
    return true;
  }, [draft, step]);

  const next = useCallback(() => {
    if (!validateStep(step)) return;
    setStep((s) => (s < 3 ? ((s + 1) as WizardStep) : s));
  }, [step, validateStep]);

  const prev = useCallback(() => {
    setStep((s) => (s > 1 ? ((s - 1) as WizardStep) : s));
  }, []);

  const goTo = useCallback(
    (target: WizardStep) => {
      if (target <= step) {
        setStep(target);
        return;
      }
      // Jumping forward requires every prior step to validate.
      for (let s: WizardStep = 1; s < target; s = (s + 1) as WizardStep) {
        if (!validateStep(s)) {
          setStep(s);
          return;
        }
      }
      setStep(target);
    },
    [step, validateStep]
  );

  const resetDraft = useCallback(() => {
    clearDraft();
    setErrors({});
    setTouched({});
    setStep(1);
  }, [clearDraft]);

  const validateAll = useCallback(() => {
    const duration = parseInt(draft.duration, 10);
    const result = validatePoolCreationForm({
      title: draft.title,
      description: draft.description,
      outcomeA: draft.outcomeA,
      outcomeB: draft.outcomeB,
      duration: Number.isNaN(duration) ? 0 : duration,
    });
    setErrors(result.errors as FormErrors);
    setTouched({
      title: true,
      description: true,
      outcomeA: true,
      outcomeB: true,
      duration: true,
    });
    return { valid: result.valid, errors: result.errors as FormErrors };
  }, [draft]);

  return {
    step,
    draft,
    errors,
    touched,
    setField,
    blurField,
    validateStep,
    next,
    prev,
    goTo,
    canAdvance,
    isFinalStep: step === 3,
    resetDraft,
    validateAll,
  };
}
