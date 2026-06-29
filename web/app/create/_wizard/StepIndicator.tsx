'use client';

import { Check } from 'lucide-react';
import type { WizardStep } from './useCreateWizard';

const STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: 1, label: 'Question' },
  { id: 2, label: 'Parameters' },
  { id: 3, label: 'Review' },
];

export interface StepIndicatorProps {
  current: WizardStep;
  onJump: (target: WizardStep) => void;
}

export function StepIndicator({ current, onJump }: StepIndicatorProps) {
  return (
    <ol className="flex items-center gap-2 mb-8" aria-label="Pool creation steps">
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
  );
}
