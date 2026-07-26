'use client';

import { Check } from 'lucide-react';
import type { WizardStep } from './useCreateWizard';

const STEPS: Array<{ id: WizardStep; label: string; shortLabel: string }> = [
  { id: 1, label: 'Template', shortLabel: 'Tpl' },
  { id: 2, label: 'Basics', shortLabel: 'Basics' },
  { id: 3, label: 'Outcomes', shortLabel: 'Out' },
  { id: 4, label: 'Parameters', shortLabel: 'Params' },
  { id: 5, label: 'Review', shortLabel: 'Review' },
];

export interface StepIndicatorProps {
  current: WizardStep;
  onJump: (target: WizardStep) => void;
}

export function StepIndicator({ current, onJump }: StepIndicatorProps) {
  return (
    <>
      <ol
        className="hidden sm:flex items-center gap-2 mb-8 flex-wrap"
        aria-label="Pool creation steps"
      >
        {STEPS.map((step, idx) => {
          const status: 'completed' | 'current' | 'upcoming' =
            step.id < current ? 'completed' : step.id === current ? 'current' : 'upcoming';
          return (
            <li key={step.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onJump(step.id)}
                aria-current={status === 'current' ? 'step' : undefined}
                className={`flex items-center gap-2 px-3 py-2 rounded-full border text-sm transition-colors ${
                  status === 'current'
                    ? 'border-primary text-primary bg-primary/10 font-semibold'
                    : status === 'completed'
                      ? 'border-green-500/40 text-green-400 hover:bg-green-500/10'
                      : 'border-border text-muted-foreground hover:bg-muted/40'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                    status === 'current'
                      ? 'bg-primary text-primary-foreground'
                      : status === 'completed'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-muted/40 text-muted-foreground'
                  }`}
                >
                  {status === 'completed' ? <Check className="w-3 h-3" /> : step.id}
                </span>
                <span>{step.label}</span>
              </button>
              {idx < STEPS.length - 1 && (
                <span className="text-muted-foreground/50" aria-hidden="true">
                  →
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="sm:hidden mb-6 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            Step {current} of {STEPS.length}
          </span>
          <span className="text-muted-foreground">
            {STEPS.find((step) => step.id === current)?.label}
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${(current / STEPS.length) * 100}%` }}
          />
        </div>
        <div className="flex justify-between gap-1">
          {STEPS.map((step) => (
            <button
              key={step.id}
              type="button"
              onClick={() => onJump(step.id)}
              aria-label={step.label}
              aria-current={step.id === current ? 'step' : undefined}
              className={`flex-1 py-1 text-[10px] rounded ${
                step.id === current
                  ? 'bg-primary/15 text-primary font-semibold'
                  : step.id < current
                    ? 'text-green-500'
                    : 'text-muted-foreground'
              }`}
            >
              {step.shortLabel}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
