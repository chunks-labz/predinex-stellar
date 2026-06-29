'use client';

import { ExternalLink, Wallet } from 'lucide-react';

interface FreighterInstallPromptProps {
  /** When provided, clicking "Try again" calls this instead of hard-reloading */
  onRetry?: () => void;
  className?: string;
}

/**
 * Displayed when the user clicks "Connect Wallet" but Freighter is not installed.
 * Provides a direct link to the Freighter extension and a retry option.
 */
export function FreighterInstallPrompt({ onRetry, className = '' }: FreighterInstallPromptProps) {
  const handleRetry = () => {
    if (onRetry) {
      onRetry();
    } else {
      window.location.reload();
    }
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`flex flex-col items-center gap-4 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-6 text-center ${className}`}
    >
      <Wallet className="h-10 w-10 text-yellow-500" aria-hidden="true" />
      <div>
        <p className="font-semibold text-foreground">Freighter not detected</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Install the Freighter browser extension to connect your Stellar wallet.
        </p>
      </div>
      <a
        href="https://www.freighter.app/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/50"
      >
        Install Freighter
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </a>
      <button
        onClick={handleRetry}
        className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus:outline-none"
      >
        I installed it — try again
      </button>
    </div>
  );
}
