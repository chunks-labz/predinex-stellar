'use client';

export interface DepthLevel {
  price: number;
  quantity: number;
}

interface DepthChartProps {
  bids: DepthLevel[];
  asks: DepthLevel[];
  isLoading?: boolean;
}

function sidePath(levels: DepthLevel[], width: number, height: number): string {
  if (!levels.length) return '';
  const max = Math.max(...levels.map((level) => level.quantity), 1);
  const points = levels.map((level, index) => {
    const x = (index / Math.max(levels.length - 1, 1)) * width;
    const y = height - (level.quantity / max) * (height - 8);
    return `${x},${y}`;
  });
  return `0,${height} ${points.join(' ')} ${width},${height}`;
}

export default function DepthChart({ bids, asks, isLoading = false }: DepthChartProps) {
  if (isLoading) return <div className="h-56 rounded-xl bg-muted/30 animate-pulse" role="status" aria-label="Loading market depth" />;
  if (!bids.length && !asks.length) {
    return <div className="rounded-xl border border-border/50 bg-muted/20 px-4 py-12 text-center text-sm text-muted-foreground">No market depth available yet.</div>;
  }
  const width = 500;
  const height = 180;
  return (
    <section aria-label="Market depth" className="rounded-xl border border-border/50 bg-muted/20 p-4">
      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Market Depth</h2><div className="flex gap-4 text-xs"><span className="text-green-400">● Bids</span><span className="text-red-400">● Asks</span></div></div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full" role="img" aria-label="Bid and ask depth chart" preserveAspectRatio="none">
        <polygon points={sidePath(bids, width / 2, height)} fill="currentColor" className="text-green-500/20" />
        <polygon points={sidePath(asks, width / 2, height)} transform={`translate(${width / 2} 0)`} fill="currentColor" className="text-red-500/20" />
        <line x1={width / 2} y1="0" x2={width / 2} y2={height} className="stroke-border" strokeDasharray="4 4" />
      </svg>
      <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground"><span>{bids.length} bid level{bids.length === 1 ? '' : 's'}</span><span className="text-right">{asks.length} ask level{asks.length === 1 ? '' : 's'}</span></div>
    </section>
  );
}
