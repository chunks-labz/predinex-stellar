'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { logger } from '@/app/lib/logger';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        logger.error('Uncaught error', 'ErrorBoundary', {
            message: error.message,
            componentStack: errorInfo.componentStack,
        });
        import('@/app/lib/error-reporter').then(({ reportError }) =>
            reportError(error, {
                componentStack: errorInfo.componentStack ?? undefined,
                boundary: 'ErrorBoundary',
            })
        );
    }

    render() {
        if (this.state.hasError) {
            return this.props.fallback || (
                <div className="pt-32 pb-20 max-w-2xl mx-auto px-4 sm:px-6">
                    <div className="glass p-8 rounded-2xl border border-red-500/20 text-center">
                        <AlertTriangle className="w-16 h-16 mx-auto mb-4 text-red-500" />
                        <h2 className="text-2xl font-bold mb-4 text-red-500">Something went wrong</h2>
                        <p className="text-muted-foreground mb-6">
                            An error occurred with the wallet connection. Please refresh the page and try again.
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            className="bg-red-500/10 hover:bg-red-500/20 text-red-500 px-6 py-3 rounded-full border border-red-500/20 transition-colors font-medium"
                        >
                            Refresh Page
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}