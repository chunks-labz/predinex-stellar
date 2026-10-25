'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';
import Link from 'next/link';
import { logger } from '@/app/lib/logger';

interface RouteErrorBoundaryProps {
  children: ReactNode;
  /**
   * Optional route label shown in the error UI (e.g. "Markets", "Dashboard").
   * Helps users understand which section encountered the error.
   */
  routeName?: string;
  /**
   * Optional custom fallback to render instead of the default error UI.
   * Receives `error` and `reset` so the caller can build contextual recovery.
   */
  fallback?: (props: { error: Error; reset: () => void }) => ReactNode;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * RouteErrorBoundary
 *
 * A shared error boundary designed to wrap individual Next.js App Router
 * route segments. It catches runtime errors that bubble up from within a
 * route and renders a friendly, branded fallback instead of crashing the
 * entire page.
 *
 * ## Usage
 * Wrap the page content (not the layout) of any critical route:
 *
 * ```tsx
 * // app/markets/page.tsx
 * export default function MarketsPage() {
 *   return (
 *     <RouteErrorBoundary routeName="Markets">
 *       <MarketsContent />
 *     </RouteErrorBoundary>
 *   );
 * }
 * ```
 *
 * ## Recovery
 * The default fallback provides two recovery paths:
 * 1. **Try Again** – resets the error boundary state so React re-renders
 *    the subtree. Use this for transient failures (network, API blip).
 * 2. **Go Home** – navigates to the root page as a hard escape hatch.
 *
 * ## Adding new routes
 * 1. Import `RouteErrorBoundary` from `@/components/RouteErrorBoundary`.
 * 2. Wrap the page's primary content block.
 * 3. Provide a descriptive `routeName` prop so error messages are contextual.
 */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  public state: RouteErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error(
      `Uncaught error in route "${this.props.routeName ?? 'unknown'}"`,
      'RouteErrorBoundary',
      { message: error.message, componentStack: errorInfo.componentStack }
    );
    import('@/app/lib/error-reporter').then(({ reportError }) =>
      reportError(error, {
        componentStack: errorInfo.componentStack ?? undefined,
        boundary: `RouteErrorBoundary(${this.props.routeName ?? 'unknown'})`,
      })
    );
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError && this.state.error) {
      // Allow the consumer to provide a fully custom fallback
      if (this.props.fallback) {
        return this.props.fallback({
          error: this.state.error,
          reset: this.handleReset,
        });
      }

      const { routeName } = this.props;
      const label = routeName ? `the ${routeName} page` : 'this page';

      return (
        <div
          role="alert"
          className="min-h-[60vh] flex items-center justify-center p-6"
        >
          <div className="glass p-8 rounded-2xl max-w-lg w-full text-center space-y-6 border border-red-500/10">
            {/* Icon */}
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-red-500" aria-hidden="true" />
            </div>

            {/* Heading & description */}
            <div className="space-y-2">
              <h2 className="text-2xl font-bold">Something went wrong</h2>
              <p className="text-muted-foreground">
                An unexpected error occurred while loading {label}.
                You can try again or return to the home page.
              </p>
            </div>

            {/* Error details (collapsed by default) */}
            <details className="text-left">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors select-none">
                Show error details
              </summary>
              <div className="mt-2 bg-muted/50 p-3 rounded-lg text-xs font-mono text-muted-foreground overflow-auto max-h-28 break-all">
                {this.state.error.message}
              </div>
            </details>

            {/* Recovery actions */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={this.handleReset}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-primary text-white font-bold rounded-xl transition-all hover:scale-105 active:scale-95 shadow-lg shadow-primary/20"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                Try Again
              </button>

              <Link
                href="/"
                className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-muted hover:bg-muted/80 text-foreground font-bold rounded-xl transition-all hover:scale-105 active:scale-95"
              >
                <Home className="w-4 h-4" aria-hidden="true" />
                Go Home
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default RouteErrorBoundary;
