'use client';

import { useEffect } from 'react';

export interface UseEscapeDismissOptions {
  active: boolean;
  onDismiss: () => void;
}

export function useEscapeDismiss({ active, onDismiss }: UseEscapeDismissOptions): void {
  useEffect(() => {
    if (!active) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismiss();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [active, onDismiss]);
}
