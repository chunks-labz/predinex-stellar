export default function MarketCardSkeleton() {
    return (
        <div
            className="p-8 rounded-3xl border border-border bg-card/40 h-full min-h-[320px] flex flex-col glass animate-pulse"
            role="status"
            aria-label="Loading market"
            aria-busy="true"
        >
            {/* Status Badge Skeleton */}
            <div className="flex justify-between items-center mb-6">
                <div className="h-6 w-16 bg-muted rounded-full" />
                <div className="h-4 w-20 bg-muted/30 rounded" />
            </div>

            {/* Title Skeleton */}
            <div className="h-7 bg-muted rounded w-3/4 mb-3" />
            <div className="h-7 bg-muted rounded w-1/2 mb-3" />

            {/* Description Skeleton */}
            <div className="h-4 bg-muted/50 rounded w-full mb-2" />
            <div className="h-4 bg-muted/50 rounded w-5/6 mb-8" />

            {/* Footer Skeleton */}
            <div className="mt-auto flex items-center justify-between pt-6 border-t border-border/50">
                <div className="flex items-center gap-4">
                    <div className="flex flex-col gap-1">
                        <div className="h-2 w-10 bg-muted rounded" />
                        <div className="h-5 w-24 bg-muted rounded" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <div className="h-2 w-10 bg-muted rounded" />
                        <div className="h-5 w-24 bg-muted rounded" />
                    </div>
                </div>
                <div className="h-8 w-8 bg-muted rounded-xl" />
            </div>
        </div>
    );
}
