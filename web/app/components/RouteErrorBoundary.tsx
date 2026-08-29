'use client';

import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';
import Link from 'next/link';

interface Props {
    children: ReactNode;
    routeName?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

/**
 * RouteErrorBoundary wraps individual route pages to catch and gracefully display
 * runtime errors without crashing the entire application.
 *
 * Usage:
 *   <RouteErrorBoundary routeName="Home">
 *     <YourPageContent />
 *   </RouteErrorBoundary>
 */
export default class RouteErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
        };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error(
            `[RouteErrorBoundary] Uncaught error on route "${this.props.routeName ?? 'unknown'}":`,
            error,
            errorInfo
        );
        this.setState({ error, errorInfo });
    }

    private handleReset = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    render() {
        if (this.state.hasError) {
            return (
                <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
                    <div className="glass-panel p-10 rounded-2xl max-w-lg w-full text-center space-y-6">
                        {/* Icon */}
                        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
                            <AlertTriangle className="w-8 h-8 text-red-500" />
                        </div>

                        {/* Heading */}
                        <div className="space-y-2">
                            <h2 className="text-2xl font-bold">Something went wrong</h2>
                            <p className="text-muted-foreground text-sm">
                                {this.props.routeName
                                    ? `An unexpected error occurred on the ${this.props.routeName} page.`
                                    : 'An unexpected error occurred on this page.'}
                                {' '}Try reloading or return to the home page.
                            </p>
                        </div>

                        {/* Error details (dev only) */}
                        {process.env.NODE_ENV === 'development' && this.state.error && (
                            <details className="text-left">
                                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
                                    Error Details (Development)
                                </summary>
                                <pre className="mt-2 p-4 bg-muted/50 rounded-lg text-xs font-mono overflow-auto max-h-36 text-red-400">
                                    {this.state.error.message}
                                    {this.state.error.stack && `\n\n${this.state.error.stack}`}
                                </pre>
                            </details>
                        )}

                        {/* Actions */}
                        <div className="flex flex-col sm:flex-row gap-3 justify-center">
                            <button
                                onClick={() => {
                                    this.handleReset();
                                    window.location.reload();
                                }}
                                className="flex items-center justify-center gap-2 px-6 py-3 bg-primary text-white font-bold rounded-xl transition-all hover:scale-105 active:scale-95 shadow-lg shadow-primary/20"
                            >
                                <RotateCcw className="w-4 h-4" />
                                Reload Page
                            </button>
                            <Link
                                href="/"
                                onClick={this.handleReset}
                                className="flex items-center justify-center gap-2 px-6 py-3 bg-muted text-muted-foreground font-bold rounded-xl border border-border hover:bg-muted/80 transition-colors"
                            >
                                <Home className="w-4 h-4" />
                                Go Home
                            </Link>
                        </div>
                    </div>
                </main>
            );
        }

        return this.props.children;
    }
}
