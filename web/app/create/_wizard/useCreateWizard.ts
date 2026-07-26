'use client';

import { useCallback, useMemo, useState } from 'react';
import { useLocalStorage } from '../../lib/hooks/useLocalStorage';
import {
  DEFAULT_PROTOCOL_FEE_BPS,
  MAX_OUTCOMES,
  MIN_OUTCOMES,
  validateDepositDeadline,
  validateDuration,
  validateField,
  validateOutcomesList,
  validatePoolDescription,
  validatePoolTitle,
  validatePoolWizardForm,
  validateProtocolFeeBps,
  validateSettlementType,
  type SettlementType,
} from '@/lib/validators';
import {
  draftFromSavedTemplate,
  loadSavedTemplates,
  type SavedPoolTemplate,
} from './pool-templates';
import type { OnChainPoolTemplate } from '@/app/lib/soroban-template-api';

export const CREATE_MARKET_DRAFT_KEY = 'predinex_create_market_draft_v2';
/** @deprecated Use CREATE_MARKET_DRAFT_KEY */
export const CREATE_POOL_DRAFT_KEY = CREATE_MARKET_DRAFT_KEY;

export type TemplateSource = 'blank' | 'public' | 'saved';
export type WizardStep = 1 | 2 | 3 | 4 | 5;

export interface CreatePoolDraft {
  templateSource: TemplateSource;
  templateId: string | null;
  title: string;
  description: string;
  category: string;
  tags: string;
  outcomes: string[];
  duration: string;
  depositDeadline: string;
  protocolFeeBps: string;
  settlementType: SettlementType;
  referenceLink: string;
  /** #721 — How the pool outcome will be determined (Markdown supported). */
  resolutionCriteria: string;
  /** #721 — Pipe-separated list of reference URLs (up to 5). */
  externalLinks: string;
  /** #721 — URL of a cover image shown on pool cards/detail page. */
  coverImage: string;
}

/** @deprecated Use CreatePoolDraft */
export type CreateMarketDraft = CreatePoolDraft;

export const EMPTY_DRAFT: CreatePoolDraft = {
  templateSource: 'blank',
  templateId: null,
  title: '',
  description: '',
  category: 'crypto',
  tags: '',
  outcomes: ['', ''],
  duration: '',
  depositDeadline: '',
  protocolFeeBps: String(DEFAULT_PROTOCOL_FEE_BPS),
  settlementType: 'twap',
  referenceLink: '',
  resolutionCriteria: '',
  externalLinks: '',
  coverImage: '',
};

export type FormErrors = Partial<Record<string, string>>;

const STEP_FIELDS: Record<WizardStep, string[]> = {
  1: [],
  2: ['title', 'description'],
  3: [],
  4: ['duration', 'depositDeadline', 'protocolFeeBps', 'settlementType'],
  5: [],
};

export interface UseCreateWizard {
  step: WizardStep;
  draft: CreatePoolDraft;
  errors: FormErrors;
  touched: Record<string, boolean>;
  setField: (field: keyof CreatePoolDraft, value: string | boolean) => void;
  setOutcome: (index: number, value: string) => void;
  addOutcome: () => void;
  removeOutcome: (index: number) => void;
  selectTemplate: (
    source: TemplateSource,
    id: string | null,
    seed?: Partial<CreatePoolDraft>
  ) => void;
  applyDeepLinkTemplate: (
    source: 'public' | 'saved',
    id: string,
    publicTemplates: OnChainPoolTemplate[],
    savedTemplates: SavedPoolTemplate[]
  ) => boolean;
  blurField: (field: keyof CreatePoolDraft) => void;
  validateStep: (step: WizardStep) => boolean;
  next: () => void;
  prev: () => void;
  goTo: (step: WizardStep) => void;
  canAdvance: boolean;
  isFinalStep: boolean;
  resetDraft: () => void;
  validateAll: () => { valid: boolean; errors: FormErrors };
}

function migrateLegacyDraft(raw: unknown): CreatePoolDraft {
  if (!raw || typeof raw !== 'object') return EMPTY_DRAFT;
  const legacy = raw as Record<string, unknown>;
  if (Array.isArray(legacy.outcomes)) {
    return { ...EMPTY_DRAFT, ...(legacy as CreatePoolDraft) };
  }
  if (typeof legacy.outcomeA === 'string' || typeof legacy.outcomeB === 'string') {
    return {
      ...EMPTY_DRAFT,
      title: String(legacy.title ?? ''),
      description: String(legacy.description ?? ''),
      category: String(legacy.category ?? 'crypto'),
      referenceLink: String(legacy.referenceLink ?? ''),
      duration: String(legacy.duration ?? ''),
      outcomes: [String(legacy.outcomeA ?? ''), String(legacy.outcomeB ?? '')],
    };
  }
  return { ...EMPTY_DRAFT, ...(legacy as CreatePoolDraft) };
}

export function useCreateWizard(): UseCreateWizard {
  const [draft, setDraft, clearDraft] = useLocalStorage<CreatePoolDraft>(
    CREATE_POOL_DRAFT_KEY,
    EMPTY_DRAFT,
    migrateLegacyDraft
  );
  const [step, setStep] = useState<WizardStep>(1);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const setField = useCallback(
    (field: keyof CreatePoolDraft, value: string | boolean) => {
      setDraft((prev) => ({ ...prev, [field]: value }));
      if (typeof value === 'string') {
        const error = validateField(field, value);
        setErrors((prev) => ({ ...prev, [field]: error }));
      }
    },
    [setDraft]
  );

  const setOutcome = useCallback(
    (index: number, value: string) => {
      setDraft((prev) => {
        const outcomes = [...prev.outcomes];
        outcomes[index] = value;
        return { ...prev, outcomes };
      });
      const validation = validateOutcomesList(
        draft.outcomes.map((outcome, idx) => (idx === index ? value : outcome))
      );
      setErrors((prev) => {
        const next = { ...prev };
        delete next.outcomes;
        Object.keys(next).forEach((key) => {
          if (key.startsWith('outcome_')) delete next[key];
        });
        return { ...next, ...validation.errors };
      });
    },
    [draft.outcomes, setDraft]
  );

  const addOutcome = useCallback(() => {
    setDraft((prev) => {
      if (prev.outcomes.length >= MAX_OUTCOMES) return prev;
      return { ...prev, outcomes: [...prev.outcomes, ''] };
    });
  }, [setDraft]);

  const removeOutcome = useCallback(
    (index: number) => {
      setDraft((prev) => {
        if (prev.outcomes.length <= MIN_OUTCOMES) return prev;
        const outcomes = prev.outcomes.filter((_, idx) => idx !== index);
        return { ...prev, outcomes };
      });
      setErrors((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((key) => {
          if (key.startsWith('outcome_')) delete next[key];
        });
        return next;
      });
    },
    [setDraft]
  );

  const selectTemplate = useCallback(
    (source: TemplateSource, id: string | null, seed?: Partial<CreatePoolDraft>) => {
      setDraft((prev) => ({
        ...prev,
        templateSource: source,
        templateId: id,
        ...seed,
      }));
      setErrors({});
      setTouched({});
    },
    [setDraft]
  );

  const applyDeepLinkTemplate = useCallback(
    (
      source: 'public' | 'saved',
      id: string,
      publicTemplates: OnChainPoolTemplate[],
      savedTemplates: SavedPoolTemplate[]
    ) => {
      if (source === 'public') {
        const template = publicTemplates.find((entry) => String(entry.id) === id);
        if (!template) return false;
        selectTemplate('public', id, {
          title: template.title,
          description: template.description,
          outcomes: [...template.outcomes],
          duration: String(template.duration),
          depositDeadline: String(Math.min(template.duration - 60, template.duration / 2)),
        });
        return true;
      }

      const template = savedTemplates.find((entry) => entry.id === id);
      if (!template) return false;
      selectTemplate('saved', id, draftFromSavedTemplate(template));
      return true;
    },
    [selectTemplate]
  );

  const blurField = useCallback(
    (field: keyof CreatePoolDraft) => {
      setTouched((prev) => ({ ...prev, [field]: true }));
      const raw = draft[field];
      if (typeof raw === 'string') {
        const error = validateField(field, raw);
        setErrors((prev) => ({ ...prev, [field]: error }));
      }
    },
    [draft]
  );

  const validateStep = useCallback(
    (target: WizardStep): boolean => {
      const nextErrors: FormErrors = {};
      const nextTouched: Record<string, boolean> = {};

      if (target === 1) {
        setTouched((prev) => ({ ...prev, templateSource: true }));
        return true;
      }

      if (target === 2) {
        for (const field of STEP_FIELDS[2]) {
          const raw = String(draft[field as keyof CreatePoolDraft] ?? '');
          nextTouched[field] = true;
          const error = validateField(field, raw);
          if (error) nextErrors[field] = error;
        }
      }

      if (target === 3) {
        const outcomesValidation = validateOutcomesList(draft.outcomes);
        Object.assign(nextErrors, outcomesValidation.errors);
        draft.outcomes.forEach((_, index) => {
          nextTouched[`outcome_${index}`] = true;
        });
      }

      if (target === 4) {
        const duration = Number.parseInt(draft.duration, 10);
        const depositDeadline = Number.parseInt(draft.depositDeadline, 10);
        const protocolFeeBps = Number.parseInt(draft.protocolFeeBps, 10);

        nextTouched.duration = true;
        nextTouched.depositDeadline = true;
        nextTouched.protocolFeeBps = true;
        nextTouched.settlementType = true;

        const durationValidation = validateDuration(duration);
        if (!durationValidation.valid) nextErrors.duration = durationValidation.error!;

        const depositValidation = validateDepositDeadline(depositDeadline, duration);
        if (!depositValidation.valid) nextErrors.depositDeadline = depositValidation.error!;

        const feeValidation = validateProtocolFeeBps(protocolFeeBps);
        if (!feeValidation.valid) nextErrors.protocolFeeBps = feeValidation.error!;

        const settlementValidation = validateSettlementType(draft.settlementType);
        if (!settlementValidation.valid) nextErrors.settlementType = settlementValidation.error!;
      }

      setErrors((prev) => ({ ...prev, ...nextErrors }));
      setTouched((prev) => ({ ...prev, ...nextTouched }));
      return Object.keys(nextErrors).length === 0;
    },
    [draft]
  );

  const canAdvance = useMemo(() => {
    if (step === 1) return true;
    if (step === 2) {
      return (
        validatePoolTitle(draft.title).valid && validatePoolDescription(draft.description).valid
      );
    }
    if (step === 3) {
      return validateOutcomesList(draft.outcomes).valid;
    }
    if (step === 4) {
      const duration = Number.parseInt(draft.duration, 10);
      const depositDeadline = Number.parseInt(draft.depositDeadline, 10);
      const protocolFeeBps = Number.parseInt(draft.protocolFeeBps, 10);
      return (
        validateDuration(duration).valid &&
        validateDepositDeadline(depositDeadline, duration).valid &&
        validateProtocolFeeBps(protocolFeeBps).valid &&
        validateSettlementType(draft.settlementType).valid
      );
    }
    return true;
  }, [draft, step]);

  const next = useCallback(() => {
    if (!validateStep(step)) return;
    setStep((s) => (s < 5 ? ((s + 1) as WizardStep) : s));
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
    const duration = Number.parseInt(draft.duration, 10);
    const depositDeadline = Number.parseInt(draft.depositDeadline, 10);
    const protocolFeeBps = Number.parseInt(draft.protocolFeeBps, 10);
    const result = validatePoolWizardForm({
      title: draft.title,
      description: draft.description,
      outcomes: draft.outcomes,
      duration: Number.isNaN(duration) ? 0 : duration,
      depositDeadline: Number.isNaN(depositDeadline) ? 0 : depositDeadline,
      protocolFeeBps: Number.isNaN(protocolFeeBps) ? 0 : protocolFeeBps,
      settlementType: draft.settlementType,
    });
    setErrors(result.errors);
    setTouched({
      title: true,
      description: true,
      duration: true,
      depositDeadline: true,
      protocolFeeBps: true,
      settlementType: true,
      ...Object.fromEntries(draft.outcomes.map((_, index) => [`outcome_${index}`, true])),
    });
    return { valid: result.valid, errors: result.errors };
  }, [draft]);

  return {
    step,
    draft,
    errors,
    touched,
    setField,
    setOutcome,
    addOutcome,
    removeOutcome,
    selectTemplate,
    applyDeepLinkTemplate,
    blurField,
    validateStep,
    next,
    prev,
    goTo,
    canAdvance,
    isFinalStep: step === 5,
    resetDraft,
    validateAll,
  };
}

export function getSavedTemplatesSnapshot(): SavedPoolTemplate[] {
  return loadSavedTemplates();
}
