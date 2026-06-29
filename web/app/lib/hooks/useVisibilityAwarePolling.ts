'use client';

import { useCallback, useEffect, useRef } from 'react';

export interface VisibilityAwarePollingOptions {
  enabled?: boolean;
  immediate?: boolean;
}

function isDocumentVisible(): boolean {
  return typeof document === 'undefined' ? true : !document.hidden;
}

/**
 * Runs an async polling callback while the document is visible.
 *
 * Policy:
 * - Poll immediately when enabled and the document is visible.
 * - Stop scheduling new polls while the document is hidden.
 * - Resume with an immediate poll when the document becomes visible again.
 */
export function useVisibilityAwarePolling(
  callback: () => Promise<void> | void,
  intervalMs: number,
  options: VisibilityAwarePollingOptions = {}
): void {
  const { enabled = true, immediate = true } = options;
  const callbackRef = useRef(callback);
  const enabledRef = useRef(enabled);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const runPoll = useCallback(async () => {
    clearTimer();

    if (!enabledRef.current || !isDocumentVisible()) {
      return;
    }

    runningRef.current = true;

    try {
      await callbackRef.current();
    } finally {
      runningRef.current = false;
    }

    if (!enabledRef.current || !isDocumentVisible()) {
      return;
    }

    timeoutRef.current = setTimeout(() => {
      void runPoll();
    }, intervalMs);
  }, [clearTimer, intervalMs]);

  useEffect(() => {
    if (!enabled) {
      clearTimer();
      return;
    }

    const handleVisibilityChange = () => {
      if (!enabledRef.current) {
        clearTimer();
        return;
      }

      if (!isDocumentVisible()) {
        clearTimer();
        return;
      }

      if (!timeoutRef.current && !runningRef.current) {
        void runPoll();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);

    if (immediate && isDocumentVisible()) {
      void runPoll();
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
      clearTimer();
    };
  }, [clearTimer, enabled, immediate, runPoll]);
}
