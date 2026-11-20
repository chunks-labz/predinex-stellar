'use client';

import { useState, useEffect, useRef } from 'react';
import { Share2, Link, Check, X, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import { cn } from '../lib/utils';
import { useFocusTrap } from '@/app/lib/hooks/useFocusTrap';
import { useEscapeDismiss } from '@/app/lib/hooks/useEscapeDismiss';

type FeedbackState = 'idle' | 'copied' | 'shared' | 'error' | 'copy-error';

/**
 * Legacy copy path for when the async Clipboard API is missing or rejects
 * (insecure origin, denied permission, some embedded webviews).
 */
function copyWithSelection(value: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    return false;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

interface ShareButtonProps {
  url: string;
  title?: string;
  text?: string;
  className?: string;
}

/**
 * ShareButton - Provides copy-link, native share, and QR code actions for a market page.
 * Falls back to copy-link when the Web Share API is unavailable (e.g. desktop).
 * QR code is generated client-side via the `qrcode` library — no URL leaves the browser.
 */
export default function ShareButton({ url, title, text, className }: ShareButtonProps) {
  const [feedback, setFeedbackState] = useState<FeedbackState>('idle');
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  // Detected after mount: reading `navigator` during render made the server
  // and client markup disagree (hydration mismatch) on share-capable devices.
  const [canNativeShare, setCanNativeShare] = useState(false);
  const qrPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCanNativeShare(
      typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ url })
    );
  }, [url]);

  useFocusTrap({ active: qrOpen, containerRef: qrPanelRef });
  useEscapeDismiss({ active: qrOpen, onDismiss: () => setQrOpen(false) });

  useEffect(() => {
    if (!qrOpen || !url) return;
    QRCode.toDataURL(url, { width: 200, margin: 2 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [qrOpen, url]);

  function showFeedback(state: FeedbackState) {
    setFeedbackState(state);
    setTimeout(() => setFeedbackState('idle'), 2500);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      showFeedback('copied');
    } catch {
      showFeedback(copyWithSelection(url) ? 'copied' : 'copy-error');
    }
  }

  async function handleShare() {
    try {
      await navigator.share({ url, title, text });
      showFeedback('shared');
    } catch (err) {
      // AbortError means the user dismissed the sheet — not a real error
      if (err instanceof Error && err.name !== 'AbortError') {
        showFeedback('error');
      }
    }
  }

  function handleQrOpen() {
    setQrOpen(true);
  }

  function handleQrClose() {
    setQrOpen(false);
  }

  const feedbackLabel: Record<FeedbackState, string> = {
    idle: '',
    copied: 'Link copied!',
    shared: 'Shared!',
    error: 'Something went wrong',
    'copy-error': "Couldn't copy — open QR to copy the link manually",
  };

  const feedbackColor: Record<FeedbackState, string> = {
    idle: '',
    copied: 'text-green-400',
    shared: 'text-green-400',
    error: 'text-red-400',
    'copy-error': 'text-red-400',
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Copy-link button — always visible */}
      <button
        onClick={handleCopy}
        aria-label="Copy market link to clipboard"
        title="Copy link"
        className={cn(
          'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all',
          'bg-muted/60 hover:bg-muted border border-border hover:border-primary/40',
          'active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
          feedback === 'copied' && 'border-green-500/40 bg-green-500/10'
        )}
      >
        {feedback === 'copied' ? (
          <Check className="w-3.5 h-3.5 text-green-400" aria-hidden="true" />
        ) : (
          <Link className="w-3.5 h-3.5" aria-hidden="true" />
        )}
        <span className={cn(feedback === 'copied' ? 'text-green-400' : '')}>
          {feedback === 'copied' ? 'Copied!' : 'Copy link'}
        </span>
      </button>

      {/* QR code button — always visible */}
      <button
        onClick={handleQrOpen}
        aria-label="Show QR code for this market"
        title="QR code"
        className={cn(
          'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all',
          'bg-muted/60 hover:bg-muted border border-border hover:border-primary/40',
          'active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2'
        )}
      >
        <QrCode className="w-3.5 h-3.5" aria-hidden="true" />
        <span>QR</span>
      </button>

      {/* Native share button — only rendered when the API is available */}
      {canNativeShare && (
        <button
          onClick={handleShare}
          aria-label="Share this market"
          title="Share"
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all',
            'bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary',
            'active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
            feedback === 'shared' && 'border-green-500/40 bg-green-500/10 text-green-400'
          )}
        >
          {feedback === 'shared' ? (
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          <span>{feedback === 'shared' ? 'Shared!' : 'Share'}</span>
        </button>
      )}

      {/* Error / success feedback label */}
      {(feedback === 'error' || feedback === 'copy-error') && (
        <span
          role="alert"
          className={cn('text-xs font-medium flex items-center gap-1', feedbackColor[feedback])}
        >
          <X className="w-3 h-3" aria-hidden="true" />
          {feedbackLabel[feedback]}
        </span>
      )}

      {/* QR code popover/modal — generated locally, no external requests */}
      {qrOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="QR code"
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={handleQrClose}
            aria-hidden="true"
          />

          {/* Popover card */}
          <div
            ref={qrPanelRef}
            tabIndex={-1}
            className="outline-none relative z-10 flex flex-col items-center gap-3 p-5 rounded-2xl bg-background border border-border shadow-xl"
          >
            <div className="flex w-full items-center justify-between">
              <span className="text-sm font-semibold">Scan to open</span>
              <button
                onClick={handleQrClose}
                aria-label="Close QR code popover"
                className={cn(
                  'rounded-lg p-1 transition-colors',
                  'hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1'
                )}
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {qrDataUrl ? (
              // Plain <img>, not next/image: the QR code is a runtime-generated
              // data URL, which the Next image optimizer cannot process.
              <img
                src={qrDataUrl}
                alt={`QR code for ${url}`}
                width={200}
                height={200}
                className="rounded-lg"
              />
            ) : (
              <div className="w-[200px] h-[200px] flex items-center justify-center rounded-lg bg-muted">
                <span className="text-xs text-muted-foreground">Generating…</span>
              </div>
            )}

            {/* Selectable, untruncated link: the manual fallback when copying fails. */}
            <input
              type="text"
              readOnly
              value={url}
              aria-label="Market link"
              onFocus={(e) => e.currentTarget.select()}
              className="w-[200px] rounded-lg border border-border bg-muted/40 px-2 py-1 text-center text-xs text-muted-foreground"
            />
          </div>
        </div>
      )}
    </div>
  );
}
