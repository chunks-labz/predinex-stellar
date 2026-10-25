'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { logger } from '@/app/lib/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  retryCount: number;
}

export class WalletErrorBoundary extends Component<Props, State> {
  private maxRetries = 3;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Wallet Error Boundary caught an error', 'WalletErrorBoundary', {
      message: error.message,
      componentStack: errorInfo.componentStack,
    });
    
    this.setState({
      error,
      errorInfo,
    });

    // Call optional error handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    import('@/app/lib/error-reporter').then(({ reportError }) =>
      reportError(error, {
        componentStack: errorInfo.componentStack ?? undefined,
        boundary: 'WalletErrorBoundary',
      })
    );

    // Log to external service in production
    if (process.env.NODE_ENV === 'production') {
      this.logErrorToService(error, errorInfo);
    }
  }

  private logErrorToService(error: Error, errorInfo: ErrorInfo) {
    // In a real app, send this to your error tracking service (e.g. Sentry).
    // Logging here is intentionally suppressed to avoid leaking stack traces
    // to browser consoles in production. Use logger.error for structured output.
    logger.error('Error reported to service', 'WalletErrorBoundary', {
      message: error.message,
    });
  }

  private handleRetry = () => {
    if (this.state.retryCount < this.maxRetries) {
      this.setState(prevState => ({
        hasError: false,
        error: null,
        errorInfo: null,
        retryCount: prevState.retryCount + 1,
      }));
    }
  };

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
    });
  };

  private getErrorMessage(error: Error): string {
    if (error.message.includes('wallet')) {
      return 'Wallet connection error. Please check your wallet and try again.';
    }
    if (error.message.includes('network')) {
      return 'Network error. Please check your connection and try again.';
    }
    if (error.message.includes('transaction')) {
      return 'Transaction error. Please review your transaction and try again.';
    }
    return 'An unexpected error occurred. Please try again.';
  }

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const canRetry = this.state.retryCount < this.maxRetries;
      const errorMessage = this.state.error ? this.getErrorMessage(this.state.error) : 'Unknown error';

      return (
        <div className="flex flex-col items-center justify-center p-8 bg-background border border-border rounded-lg">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-8 h-8 text-red-500" />
            <h2 className="text-xl font-semibold text-foreground">Wallet Error</h2>
          </div>
          
          <p className="text-muted-foreground text-center mb-6 max-w-md">
            {errorMessage}
          </p>

          <div className="flex gap-3">
            {canRetry && (
              <button
                onClick={this.handleRetry}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Retry ({this.maxRetries - this.state.retryCount} left)
              </button>
            )}
            
            <button
              onClick={this.handleReset}
              className="flex items-center gap-2 bg-muted text-muted-foreground px-4 py-2 rounded-lg hover:bg-muted/80 transition-colors"
            >
              <Home className="w-4 h-4" />
              Reset
            </button>
          </div>

          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details className="mt-6 w-full max-w-2xl">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                Error Details (Development)
              </summary>
              <pre className="mt-2 p-4 bg-muted rounded text-xs overflow-auto">
                {this.state.error.stack}
              </pre>
              {this.state.errorInfo && (
                <pre className="mt-2 p-4 bg-muted rounded text-xs overflow-auto">
                  {this.state.errorInfo.componentStack}
                </pre>
              )}
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

// Higher-order component for easy wrapping
export function withWalletErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<Props, 'children'>
) {
  return function WrappedComponent(props: P) {
    return (
      <WalletErrorBoundary {...errorBoundaryProps}>
        <Component {...props} />
      </WalletErrorBoundary>
    );
  };
}