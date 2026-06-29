'use client';

import { RefObject, useEffect } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!style) return true;
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  return true;
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('inert') && isVisible(el)
  );
}

export interface UseFocusTrapOptions {
  active: boolean;
  containerRef: RefObject<HTMLElement | null>;
  restoreFocus?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function useFocusTrap({
  active,
  containerRef,
  restoreFocus = true,
  initialFocusRef,
}: UseFocusTrapOptions): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = (document.activeElement as HTMLElement | null) ?? null;

    const focusables = getFocusable(container);
    const initial = initialFocusRef?.current ?? focusables[0] ?? container;
    if (initial && typeof initial.focus === 'function') {
      initial.focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const current = containerRef.current;
      if (!current) return;
      const items = getFocusable(current);
      if (items.length === 0) {
        event.preventDefault();
        current.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (activeEl === first || !current.contains(activeEl)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (restoreFocus && previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [active, containerRef, initialFocusRef, restoreFocus]);
}
