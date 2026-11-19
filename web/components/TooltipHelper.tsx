/**
 * TooltipHelper Component
 * 
 * Issue #1524: UX Improvement Iteration 4 - Contextual tooltips
 * Provides helpful tooltips for complex UI elements
 */

'use client';

import { Info, HelpCircle } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface TooltipHelperProps {
  content: string;
  children?: React.ReactNode;
  icon?: 'info' | 'help';
  position?: 'top' | 'bottom' | 'left' | 'right';
  maxWidth?: string;
}

export function TooltipHelper({
  content,
  children,
  icon = 'info',
  position = 'top',
  maxWidth = '250px',
}: TooltipHelperProps) {
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout>();

  const showTooltip = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsVisible(true);
  };

  const hideTooltip = () => {
    timeoutRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 200);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const getPositionClasses = () => {
    switch (position) {
      case 'top':
        return 'bottom-full left-1/2 -translate-x-1/2 mb-2';
      case 'bottom':
        return 'top-full left-1/2 -translate-x-1/2 mt-2';
      case 'left':
        return 'right-full top-1/2 -translate-y-1/2 mr-2';
      case 'right':
        return 'left-full top-1/2 -translate-y-1/2 ml-2';
    }
  };

  const getArrowClasses = () => {
    switch (position) {
      case 'top':
        return 'top-full left-1/2 -translate-x-1/2 -mt-1 border-l-transparent border-r-transparent border-b-transparent';
      case 'bottom':
        return 'bottom-full left-1/2 -translate-x-1/2 -mb-1 border-l-transparent border-r-transparent border-t-transparent';
      case 'left':
        return 'left-full top-1/2 -translate-y-1/2 -ml-1 border-t-transparent border-b-transparent border-r-transparent';
      case 'right':
        return 'right-full top-1/2 -translate-y-1/2 -mr-1 border-t-transparent border-b-transparent border-l-transparent';
    }
  };

  const IconComponent = icon === 'info' ? Info : HelpCircle;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        className="inline-flex items-center text-muted-foreground hover:text-foreground 
          transition-colors focus:outline-none focus:ring-2 focus:ring-primary rounded"
        aria-label="More information"
      >
        {children || <IconComponent className="w-4 h-4" aria-hidden="true" />}
      </button>

      {isVisible && (
        <div
          className={`absolute ${getPositionClasses()} z-50 animate-in fade-in zoom-in-95 duration-200`}
          role="tooltip"
          style={{ maxWidth }}
        >
          <div className="glass px-3 py-2 rounded-lg shadow-lg border border-border/50">
            <p className="text-xs text-foreground leading-relaxed">
              {content}
            </p>
          </div>
          <div
            className={`absolute ${getArrowClasses()} w-0 h-0 border-4 border-border`}
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Reusable tooltip content for common terms
 */
export const TOOLTIP_CONTENT = {
  odds: 'The probability of this outcome winning, expressed as a percentage. Higher odds mean lower payout multiplier.',
  volume: 'The total amount of XLM bet on this market across all outcomes.',
  roi: 'Return on Investment - the percentage profit you would make if your prediction is correct.',
  liquidity: 'The amount of funds available in the pool. Higher liquidity means better odds and easier trading.',
  settlement: 'The process of determining the final outcome and distributing winnings to correct predictions.',
  minimumBet: 'The smallest amount you can bet on this market, set by the market creator.',
  maximumBet: 'The largest amount you can bet on this market to prevent manipulation.',
  freeze: 'A frozen market cannot accept new bets. This typically happens during settlement or if issues are detected.',
  dispute: 'A challenge to the market outcome. During dispute period, the resolution can be contested.',
  timeRemaining: 'Time until betting closes and the market moves to settlement phase.',
  participants: 'Number of unique addresses that have placed bets in this market.',
  winRate: 'Your historical success rate - percentage of bets you\'ve won out of all settled bets.',
};
