/**
 * BetConfirmationDialog Component
 * 
 * Issue #1525: UX Improvement - Bet confirmation with summary
 * Shows clear summary before user confirms their bet
 */

'use client';

import { AlertTriangle, Check, X, TrendingUp } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface BetConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  betAmount: string;
  selectedOutcome: string;
  potentialWinnings: string;
  currentOdds: number;
  isProcessing?: boolean;
}

export function BetConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  betAmount,
  selectedOutcome,
  potentialWinnings,
  currentOdds,
  isProcessing = false,
}: BetConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      dialogRef.current?.focus();
      // Prevent body scroll
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isProcessing) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isProcessing, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProcessing) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bet-confirmation-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="glass p-6 rounded-xl max-w-md w-full animate-in zoom-in-95 duration-200 focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <AlertTriangle className="w-5 h-5 text-primary" aria-hidden="true" />
            </div>
            <h2
              id="bet-confirmation-title"
              className="text-xl font-bold"
            >
              Confirm Your Bet
            </h2>
          </div>
          {!isProcessing && (
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Bet Summary */}
        <div className="space-y-4 mb-6">
          <div className="p-4 rounded-lg bg-muted/30 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Betting Amount</span>
              <span className="text-lg font-bold">{betAmount} XLM</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Prediction</span>
              <span className="text-sm font-semibold text-primary truncate max-w-[200px]">
                {selectedOutcome}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Current Odds</span>
              <span className="text-sm font-medium">{currentOdds}%</span>
            </div>
            <div className="h-px bg-border/50" />
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Potential Win</span>
              <div className="flex items-center gap-1">
                <TrendingUp className="w-4 h-4 text-green-400" aria-hidden="true" />
                <span className="text-lg font-bold text-green-400">
                  {potentialWinnings} XLM
                </span>
              </div>
            </div>
          </div>

          {/* Warning */}
          <div className="p-3 rounded-lg bg-yellow-400/10 border border-yellow-400/20">
            <p className="text-xs text-yellow-600 dark:text-yellow-400">
              <strong>Important:</strong> Once confirmed, this bet cannot be canceled. 
              Make sure you're comfortable with the amount and your prediction.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="flex-1 px-4 py-3 rounded-lg border border-border/50 bg-muted/30 
              hover:bg-muted/50 transition-colors font-medium disabled:opacity-50 
              disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isProcessing}
            className="flex-1 px-4 py-3 rounded-lg bg-primary hover:bg-primary/90 
              text-primary-foreground font-semibold transition-colors 
              disabled:opacity-50 disabled:cursor-not-allowed flex items-center 
              justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" aria-hidden="true" />
                Confirm Bet
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
