'use client';

import { useEffect, useState } from 'react';
import { Copy, FileStack, Globe, LayoutTemplate, Loader2 } from 'lucide-react';
import { predinexReadApi } from '@/app/lib/adapters/predinex-read-api';
import type { OnChainPoolTemplate } from '@/app/lib/soroban-template-api';
import {
  buildTemplateShareUrl,
  loadSavedTemplates,
  type SavedPoolTemplate,
} from './pool-templates';
import type { CreatePoolDraft, TemplateSource } from './useCreateWizard';

interface StepTemplateProps {
  draft: CreatePoolDraft;
  selectTemplate: (
    source: TemplateSource,
    id: string | null,
    seed?: Partial<CreatePoolDraft>
  ) => void;
}

function templateCardClass(selected: boolean) {
  return `w-full text-left rounded-xl border p-4 transition-colors ${
    selected
      ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
      : 'border-border hover:bg-muted/30'
  }`;
}

export function StepTemplate({ draft, selectTemplate }: StepTemplateProps) {
  const [publicTemplates, setPublicTemplates] = useState<OnChainPoolTemplate[]>([]);
  const [savedTemplates, setSavedTemplates] = useState<SavedPoolTemplate[]>([]);
  const [loadingPublic, setLoadingPublic] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    setSavedTemplates(loadSavedTemplates());
    let cancelled = false;
    (async () => {
      setLoadingPublic(true);
      const templates = await predinexReadApi.getPublicTemplates();
      if (!cancelled) {
        setPublicTemplates(templates);
        setLoadingPublic(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const copyShareLink = async (source: 'public' | 'saved', id: string | number) => {
    const url = buildTemplateShareUrl(window.location.origin, source, id);
    await navigator.clipboard.writeText(url);
    setCopiedId(`${source}-${id}`);
    window.setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Start from scratch or reuse a saved configuration. Templates pre-fill the wizard so you
        can adjust details before on-chain creation.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => selectTemplate('blank', null)}
          className={templateCardClass(draft.templateSource === 'blank')}
        >
          <div className="flex items-center gap-2 font-semibold">
            <FileStack className="w-4 h-4" />
            Blank pool
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Configure every field manually from a clean slate.
          </p>
        </button>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">Public templates</h3>
        </div>
        {loadingPublic ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading on-chain templates…
          </div>
        ) : publicTemplates.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border p-4">
            No public templates are available yet. Start with a blank pool or save your own after
            creation.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {publicTemplates.map((template) => {
              const selected =
                draft.templateSource === 'public' && draft.templateId === String(template.id);
              return (
                <div key={template.id} className={templateCardClass(selected)}>
                  <button
                    type="button"
                    onClick={() =>
                      selectTemplate('public', String(template.id), {
                        title: template.title,
                        description: template.description,
                        outcomes: [...template.outcomes],
                        duration: String(template.duration),
                        depositDeadline: String(
                          Math.max(300, Math.floor(template.duration * 0.8))
                        ),
                      })
                    }
                    className="w-full text-left"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{template.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {template.outcomes.length} outcomes · {template.duration}s
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      {template.description}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => copyShareLink('public', template.id)}
                    className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Copy className="w-3 h-3" />
                    {copiedId === `public-${template.id}` ? 'Link copied' : 'Copy share link'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <LayoutTemplate className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">Your saved templates</h3>
        </div>
        {savedTemplates.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border p-4">
            Saved templates appear here after you create a pool with &quot;Save as template&quot;
            enabled on the review step.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {savedTemplates.map((template) => {
              const selected =
                draft.templateSource === 'saved' && draft.templateId === template.id;
              return (
                <div key={template.id} className={templateCardClass(selected)}>
                  <button
                    type="button"
                    onClick={() =>
                      selectTemplate('saved', template.id, {
                        title: template.draft.title,
                        description: template.draft.description,
                        category: template.draft.category,
                        tags: template.draft.tags,
                        outcomes: [...template.draft.outcomes],
                        duration: template.draft.duration,
                        depositDeadline: template.draft.depositDeadline,
                        protocolFeeBps: template.draft.protocolFeeBps,
                        settlementType: template.draft.settlementType,
                        referenceLink: template.draft.referenceLink,
                      })
                    }
                    className="w-full text-left"
                  >
                    <div className="font-medium">{template.name}</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {template.draft.outcomes.length} outcomes · saved{' '}
                      {new Date(template.createdAt).toLocaleDateString()}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => copyShareLink('saved', template.id)}
                    className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Copy className="w-3 h-3" />
                    {copiedId === `saved-${template.id}` ? 'Link copied' : 'Copy share link'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
