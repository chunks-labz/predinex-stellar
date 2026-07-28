import type { ReactNode } from 'react';

/**
 * Skeleton - Primitive component for loading placeholders
 * @param className CSS classes for sizing and positioning
 */
export default function Skeleton({ className = '' }: { className?: string }) {
    return (
        <div
            className={`animate-pulse bg-muted/40 rounded-md ${className}`}
            aria-hidden="true"
        />
    );
}

interface WithSkeletonProps {
    /** While true, the skeleton is shown instead of the children. */
    isLoading: boolean;
    /** Layout-shaped placeholder rendered during loading. */
    skeleton: ReactNode;
    /** Actual content rendered once data has arrived. */
    children: ReactNode;
    /** Optional error UI; when provided it takes precedence over loading/content. */
    error?: ReactNode;
}

/**
 * WithSkeleton - consistent wrapper for async data components.
 *
 * Renders, in priority order: an error state, a loading skeleton, or the
 * resolved content. Content and error fade in smoothly via `animate-fade-in`
 * once they replace the skeleton.
 */
export function WithSkeleton({ isLoading, skeleton, children, error }: WithSkeletonProps) {
    if (error) {
        return <div className="animate-fade-in">{error}</div>;
    }

    if (isLoading) {
        return (
            <div role="status" aria-busy="true" aria-live="polite">
                <span className="sr-only">Loading…</span>
                {skeleton}
            </div>
        );
    }

    return <div className="animate-fade-in">{children}</div>;
}
