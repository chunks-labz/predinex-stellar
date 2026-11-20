/**
 * Local saved templates and metadata helpers for the pool creation wizard.
 */
import type { CreatePoolDraft } from './useCreateWizard';
import { MIN_POOL_DURATION_SECS } from '@/lib/validators';

export const SAVED_POOL_TEMPLATES_KEY = 'predinex_saved_pool_templates_v1';
export const MAX_SAVED_TEMPLATES = 20;

export type SettlementType = 'oracle' | 'twap' | 'manual';

export interface PoolMetadata {
  category: string;
  tags: string[];
  depositDeadlineSeconds: number;
  settlementType: SettlementType;
  protocolFeeBps: number;
  referenceLink?: string;
}

export interface SavedPoolTemplate {
  id: string;
  name: string;
  createdAt: number;
  draft: Omit<CreatePoolDraft, 'templateSource' | 'templateId' | 'saveAsTemplate'>;
}

/**
 * Default deposit deadline for a template of `duration` seconds: 80% of the
 * pool's life, but never below the minimum deadline and always strictly
 * before expiry, so a template opens on a deadline that passes validation.
 */
export function defaultDepositDeadline(duration: number): number {
  const upper = Math.floor(duration) - 1;
  const preferred = Math.floor(duration * 0.8);
  return Math.max(MIN_POOL_DURATION_SECS, Math.min(preferred, upper));
}

export function parseTagsInput(tags: string): string[] {
  return tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 10);
}

export function buildPoolMetadataUri(draft: CreatePoolDraft): string {
  const metadata: PoolMetadata = {
    category: draft.category,
    tags: parseTagsInput(draft.tags),
    depositDeadlineSeconds: Number.parseInt(draft.depositDeadline, 10) || 0,
    settlementType: draft.settlementType,
    protocolFeeBps: Number.parseInt(draft.protocolFeeBps, 10) || 0,
  };
  if (draft.referenceLink.trim()) {
    metadata.referenceLink = draft.referenceLink.trim();
  }
  return `predinex://pool-meta/${encodeURIComponent(JSON.stringify(metadata))}`;
}

export function buildTemplateShareUrl(
  origin: string,
  source: 'public' | 'saved',
  id: string | number
): string {
  return `${origin}/create?template=${source}-${id}`;
}

export function parseTemplateDeepLink(
  value: string | null
): { source: 'public' | 'saved'; id: string } | null {
  if (!value) return null;
  const match = value.match(/^(public|saved)-(.+)$/);
  if (!match) return null;
  return { source: match[1] as 'public' | 'saved', id: match[2] };
}

export function loadSavedTemplates(): SavedPoolTemplate[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SAVED_POOL_TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedPoolTemplate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTemplateToLocalStorage(
  name: string,
  draft: CreatePoolDraft
): SavedPoolTemplate {
  const entry: SavedPoolTemplate = {
    id: crypto.randomUUID(),
    name: name.trim() || draft.title.trim() || 'Untitled template',
    createdAt: Date.now(),
    draft: {
      title: draft.title,
      description: draft.description,
      category: draft.category,
      tags: draft.tags,
      outcomes: draft.outcomes,
      duration: draft.duration,
      depositDeadline: draft.depositDeadline,
      protocolFeeBps: draft.protocolFeeBps,
      settlementType: draft.settlementType,
      referenceLink: draft.referenceLink,
      resolutionCriteria: draft.resolutionCriteria,
      externalLinks: draft.externalLinks,
      coverImage: draft.coverImage,
    },
  };

  const existing = loadSavedTemplates();
  const next = [entry, ...existing].slice(0, MAX_SAVED_TEMPLATES);
  window.localStorage.setItem(SAVED_POOL_TEMPLATES_KEY, JSON.stringify(next));
  return entry;
}

export function draftFromSavedTemplate(template: SavedPoolTemplate): Partial<CreatePoolDraft> {
  return {
    templateSource: 'saved',
    templateId: template.id,
    ...template.draft,
  };
}
